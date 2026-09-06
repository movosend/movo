import { randomBytes, createHash } from "node:crypto";
import { ApiError, ShipmentStatus } from "@movo/shared";
import { ShipmentRepository } from "../../repositories/shipment-repository";
import { HandshakeRepository } from "../../repositories/handshake-repository";
import { UsersClient } from "../../adapters/users-client";
import { FundsReleaseNotifier } from "../../adapters/funds-release-notifier";
import { HandshakeStage } from "../../models/handshake";
import {
  HANDSHAKE_QR_TTL_SECONDS,
  buildHandshakeCanonicalPayload,
  verifyHandshakeSignature,
} from "../../domain/handshake-crypto";
import { HANDSHAKE_MAX_DISTANCE_METERS, haversineKm } from "../../domain/geo";
import { assertIsCarrier, assertIsReceiver, assertIsSender } from "../shipments/assert-shipment-access";

type HandshakeServiceLogger =
  | { warn: (obj: unknown, msg?: string) => void }
  | undefined;

/** Subconjunto de `ioredis#Redis` que este servicio necesita -- mantiene la
 * dependencia liviana y fácil de fakear en tests unitarios. */
export interface HandshakeRedisClient {
  set(key: string, value: string, mode: "PX", durationMs: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<unknown>;
}

interface PendingHandshakeChallenge {
  stage: HandshakeStage;
  nonce: string;
  cedenteId: string;
  cedenteLat: number;
  cedenteLng: number;
}

export interface GenerateHandshakeInput {
  shipmentId: string;
  callerId: string;
  lat: number;
  lng: number;
}

export interface GenerateHandshakeResult {
  shipmentId: string;
  stage: HandshakeStage;
  nonce: string;
  canonicalPayload: string;
  expiresAt: Date;
  ttlSeconds: number;
}

export interface ConfirmHandshakeInput {
  shipmentId: string;
  callerId: string;
  nonce: string;
  signature: string;
  lat: number;
  lng: number;
}

export interface ConfirmHandshakeResult {
  shipmentId: string;
  stage: HandshakeStage;
  previousStatus: ShipmentStatus;
  status: ShipmentStatus;
  distanceM: number;
  confirmedAt: Date;
}

/**
 * Una sola clave por envío (sin el `stage` en el nombre): el `status` de un envío es
 * siempre exactamente uno, así que nunca puede haber más de un desafío legítimamente
 * pendiente a la vez -- el `stage` viaja en el JSON del valor, no en la clave.
 */
function pendingChallengeKey(shipmentId: string): string {
  return `handshake:pending:${shipmentId}`;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * AC1/AC6 de MOVO-158: usada solo en `/generate` -- el `stage` nunca lo manda el
 * cliente, se infiere del `status` actual del envío en el momento de crear el
 * desafío. `ASSIGNED` es el único estado donde el retiro todavía no pasó (cedente =
 * emisor); `IN_TRANSIT` es el único donde el retiro ya pasó pero la entrega no
 * (cedente = transportista). Cualquier otro estado no tiene handshake pendiente --
 * 409, no 403 (el problema es el estado del envío, no quién llama). `/confirm` NO usa
 * esta función -- ahí el `stage` sale del desafío pendiente ya creado, fijo desde que
 * se generó (ver el comentario de `confirmHandshake`).
 */
function inferHandshakeStage(status: ShipmentStatus): HandshakeStage {
  if (status === ShipmentStatus.ASSIGNED) {
    return "pickup";
  }
  if (status === ShipmentStatus.IN_TRANSIT) {
    return "delivery";
  }
  throw new ApiError(
    409,
    "HANDSHAKE_INVALID_SHIPMENT_STATE",
    "Este envío no tiene un handshake de custodia pendiente en su estado actual."
  );
}

export function createHandshakeService(
  shipmentRepository: ShipmentRepository,
  handshakeRepository: HandshakeRepository,
  usersClient: UsersClient,
  redis: HandshakeRedisClient,
  fundsReleaseNotifier: FundsReleaseNotifier,
  logger?: HandshakeServiceLogger
) {
  return {
    /**
     * AC1 de MOVO-158: genera y persiste (Redis, TTL 15s) el nonce del cedente junto a
     * sus coordenadas GPS, y devuelve el string canónico exacto para que el mobile
     * (MOVO-159) lo firme client-side -- este endpoint NUNCA firma nada, la clave
     * privada del cedente no sale del dispositivo (MOVO-157 AC1).
     */
    async generateHandshake(input: GenerateHandshakeInput): Promise<GenerateHandshakeResult> {
      const shipment = await shipmentRepository.findById(input.shipmentId);
      if (!shipment) {
        throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");
      }

      const stage = inferHandshakeStage(shipment.status);
      if (stage === "pickup") {
        assertIsSender(shipment, input.callerId, "Solo el emisor del envío puede generar el código de handshake de retiro.");
      } else {
        assertIsCarrier(shipment, input.callerId);
      }

      const nonce = randomBytes(32).toString("base64url");
      const canonicalPayload = buildHandshakeCanonicalPayload(input.shipmentId, stage, nonce);
      const pending: PendingHandshakeChallenge = {
        stage,
        nonce,
        cedenteId: input.callerId,
        cedenteLat: input.lat,
        cedenteLng: input.lng,
      };

      // Un solo SET con TTL: da expiración (AC5/410) y "nuevo nonce invalida el
      // anterior" (AC5) gratis por overwrite -- sin sweep, sin bookkeeping propio.
      await redis.set(pendingChallengeKey(input.shipmentId), JSON.stringify(pending), "PX", HANDSHAKE_QR_TTL_SECONDS * 1000);

      return {
        shipmentId: input.shipmentId,
        stage,
        nonce,
        canonicalPayload,
        expiresAt: new Date(Date.now() + HANDSHAKE_QR_TTL_SECONDS * 1000),
        ttlSeconds: HANDSHAKE_QR_TTL_SECONDS,
      };
    },

    /**
     * AC2-AC7 de MOVO-158: valida TTL, firma y proximidad GPS; si las tres pasan,
     * transiciona el envío y persiste el evento inmutable (`handshakeRepository
     * .confirmAndPersist`, atómico). La garantía real de exclusión mutua contra dos
     * confirmaciones concurrentes CON EL MISMO nonce es el CAS de Postgres dentro de
     * ese método (`ShipmentConcurrentModificationError`). Eso NO cubre el caso de un
     * nonce que el cedente invalidó a mitad de la request (llamando de nuevo a
     * `/generate` mientras esta confirmación seguía en curso, resolviendo
     * `findDeviceKey`/verificando la firma) -- el status del envío no cambia con un
     * `/generate`, así que el CAS no lo detectaría. Por eso, justo antes de armar
     * `from`/`to` para el CAS, se relee Redis y se revalida que el nonce siga siendo
     * el vigente (410 si no) -- ver el comentario puntual en el cuerpo del método.
     *
     * El `stage` se toma del desafío pendiente (fijado al momento de `/generate`),
     * NUNCA de una relectura de `shipment.status` acá -- hallazgo real corriendo el
     * test de concurrencia (dos `/confirm` en paralelo): si el perdedor volvía a leer
     * `shipment.status` después de que el ganador ya había commiteado la transición,
     * el resultado era la etapa siguiente (`delivery` en vez de `pickup`) y la
     * validación de actor fallaba con 403 en vez de 409/410 -- un resultado
     * semánticamente incorrecto (el problema no era el permiso del caller, era una
     * carrera). Anclar el `stage` al desafío hace que el resultado de la carrera
     * dependa únicamente del CAS de Postgres en `confirmAndPersist`, nunca de en qué
     * orden llegan las lecturas.
     */
    async confirmHandshake(input: ConfirmHandshakeInput): Promise<ConfirmHandshakeResult> {
      const shipment = await shipmentRepository.findById(input.shipmentId);
      if (!shipment) {
        throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");
      }

      const key = pendingChallengeKey(input.shipmentId);
      const raw = await redis.get(key);
      const pending = raw ? (JSON.parse(raw) as PendingHandshakeChallenge) : null;

      // Nonce ausente (vencido/nunca generado) o distinto del vigente (superado por un
      // /generate más reciente, AC5) -- mismo código para los dos: desde la
      // perspectiva del cliente, la acción es la misma ("pedile al cedente un QR
      // nuevo").
      if (!pending || pending.nonce !== input.nonce) {
        throw new ApiError(
          410,
          "HANDSHAKE_QR_EXPIRED",
          "El código QR venció o ya no es válido -- pedile a quien lo generó que cree uno nuevo."
        );
      }

      const stage = pending.stage;
      if (stage === "pickup") {
        assertIsCarrier(shipment, input.callerId);
      } else {
        assertIsReceiver(shipment, input.callerId, "Solo el receptor designado puede confirmar el handshake de entrega.");
      }

      const deviceKey = await usersClient.findDeviceKey(pending.cedenteId);
      if (!deviceKey) {
        throw new ApiError(
          409,
          "HANDSHAKE_CEDENTE_KEY_MISSING",
          "Quien generó el código no tiene una clave de dispositivo registrada."
        );
      }

      const canonicalPayload = buildHandshakeCanonicalPayload(input.shipmentId, stage, pending.nonce);
      const validSignature = await verifyHandshakeSignature(canonicalPayload, input.signature, deviceKey.publicKey);
      if (!validSignature) {
        throw new ApiError(422, "HANDSHAKE_INVALID_SIGNATURE", "La firma del código QR no es válida.");
      }

      const distanceM = haversineKm(pending.cedenteLat, pending.cedenteLng, input.lat, input.lng) * 1000;
      if (distanceM > HANDSHAKE_MAX_DISTANCE_METERS) {
        // AC4: ni el status ni el desafío pendiente se tocan -- reintentable dentro
        // del mismo TTL si el receptor se acerca.
        throw new ApiError(
          422,
          "HANDSHAKE_DISTANCE_EXCEEDED",
          `Estás a ${Math.round(distanceM)}m de quien generó el código -- tenés que estar a ` +
            `${HANDSHAKE_MAX_DISTANCE_METERS}m o menos.`
        );
      }

      // Re-chequeo de nonce vigente justo antes del CAS: entre la lectura de Redis de
      // arriba y este punto pasó trabajo de latencia variable (red a `svc-users` +
      // verificación WebCrypto) durante el cual el cedente pudo invalidar este nonce
      // llamando de nuevo a `/generate` (nonce nuevo pisa al viejo por overwrite,
      // AC5). Sin este chequeo, esta llamada en vuelo con el nonce viejo terminaría
      // igual transicionando el envío -- el status no cambió, así que el CAS de
      // Postgres de más abajo no lo hubiera detectado.
      const stillPendingRaw = await redis.get(key);
      const stillPending = stillPendingRaw ? (JSON.parse(stillPendingRaw) as PendingHandshakeChallenge) : null;
      if (!stillPending || stillPending.nonce !== pending.nonce) {
        throw new ApiError(
          410,
          "HANDSHAKE_QR_EXPIRED",
          "El código QR venció o ya no es válido -- pedile a quien lo generó que cree uno nuevo."
        );
      }

      // `from`/`to` salen del `stage` del desafío (fijo desde /generate), no de
      // `shipment.status` -- ver el comentario del método sobre por qué. Si para
      // cuando llega el CAS de `confirmAndPersist` el envío ya no está en `from`
      // (una confirmación concurrente ganó la carrera), ese método lanza
      // `ShipmentConcurrentModificationError` (409), que es la señal correcta.
      const from = stage === "pickup" ? ShipmentStatus.ASSIGNED : ShipmentStatus.IN_TRANSIT;
      const to = stage === "pickup" ? ShipmentStatus.IN_TRANSIT : ShipmentStatus.DELIVERED;
      const reason = stage === "pickup" ? "Handshake de retiro confirmado" : "Handshake de entrega confirmado";
      const roundedDistanceM = Math.round(distanceM * 100) / 100;

      const event = await handshakeRepository.confirmAndPersist({
        shipmentId: input.shipmentId,
        from,
        to,
        stage,
        actorId: input.callerId,
        counterpartyId: pending.cedenteId,
        nonceHash: sha256Hex(pending.nonce),
        counterpartyLat: pending.cedenteLat,
        counterpartyLng: pending.cedenteLng,
        actorLat: input.lat,
        actorLng: input.lng,
        distanceM: roundedDistanceM,
        reason,
      });

      // Best-effort, nunca bloquea la respuesta ya commiteada: consumir el nonce
      // (redundante con el TTL, pero cierra la ventana antes) y, solo en la entrega,
      // avisar la liberación de fondos (AC7 -- nada se libera en el retiro).
      redis.del(key).catch((err) => {
        logger?.warn(
          { err, event: "handshake_pending_cleanup_failed", shipmentId: input.shipmentId },
          "No se pudo limpiar el desafío de handshake pendiente en Redis"
        );
      });

      if (stage === "delivery" && shipment.carrierId) {
        void fundsReleaseNotifier
          .notify({ shipmentId: input.shipmentId, carrierId: shipment.carrierId })
          .catch((err) => {
            logger?.warn(
              { err, event: "funds_release_notify_failed", shipmentId: input.shipmentId },
              "No se pudo notificar la liberación de fondos"
            );
          });
      }

      return {
        shipmentId: input.shipmentId,
        stage,
        previousStatus: from,
        status: to,
        distanceM: roundedDistanceM,
        confirmedAt: event.createdAt,
      };
    },
  };
}
