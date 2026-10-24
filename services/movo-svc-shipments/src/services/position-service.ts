import {
  ApiError,
  ShipmentStatus,
  TripStatus,
  notificationTriggerCategory,
  renderNotificationTrigger,
} from "@movo/shared";
import { ShipmentRepository, ShipmentTrackingContext } from "../repositories/shipment-repository";
import { NotificationsClient } from "../adapters/notifications-client";
import { Shipment } from "../models/shipment";
import { haversineKm } from "../domain/geo";
import { PositionRepository } from "../repositories/position-repository";
import { assertIsCarrier } from "../modules/shipments/assert-shipment-access";
import { CarrierPosition, LastKnownCarrierPosition } from "../models/carrier-position";
import { POSITION_PERSISTABLE_SHIPMENT_STATUSES, TRACKABLE_SHIPMENT_STATUSES } from "../domain/shipment-state-machine";
import { classifyPickupPosition } from "../domain/pickup-attribution";
import { PickupEvidenceRepository } from "../repositories/pickup-evidence-repository";

/**
 * MOVO-202/AC4: cadencia de persistencia en Postgres. Constante, no env var -- es una
 * regla de producto fija ("cada ~45s"), no un parámetro que valga ajustar por
 * ambiente (a diferencia de los intervalos de los sweeps, que sí son operativos).
 * Exportada para que el test de cadencia del DoD la use en vez de hardcodear 45000 de
 * nuevo.
 */
export const CARRIER_POSITION_MIN_PERSIST_INTERVAL_MS = 45_000;

/** MOVO-250/AC3: tolerancia por desfase de reloj del dispositivo, SIMÉTRICA (review de PR
 * #190): un `capturedAt` hasta 2 min en el futuro respecto del reloj del servidor, o hasta
 * 2 min antes del inicio del tránsito, se acepta; más que eso se rechaza. Hacia el pasado
 * hace falta igual que hacia el futuro: el GPS puede muestrear unos segundos antes de que el
 * servidor confirme el handshake, o el reloj del teléfono puede estar atrasado, y sin
 * margen la primera muestra del tránsito se rechazaba. */
export const CAPTURED_AT_CLOCK_SKEW_TOLERANCE_MS = 2 * 60_000;

/** TTL del hash de "última posición conocida" en Redis -- puramente defensivo: en el
 * flujo normal el tracking se corta (MOVO-201/AC4) mucho antes de esto, así que esta
 * key nunca debería sobrevivir tanto. Acota igual el peor caso (un envío que se cae
 * de la máquina de estados sin que nadie lo note) en vez de dejar la key viva para
 * siempre -- mismo espíritu de minimización de datos que el resto de este ticket. */
const LAST_KNOWN_POSITION_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Los claims de tramo de cadencia viven lo mismo que la última posición: una cola offline
 * puede vaciarse horas después de capturada, y el claim tiene que seguir ahí para que un
 * tramo ya persistido no se duplique. */
const CADENCE_BUCKET_TTL_MS = LAST_KNOWN_POSITION_TTL_SECONDS * 1000;

/**
 * MOVO-251: la última posición conocida en Redis se indexa por `tripId` (no por `shipmentId`),
 * ya que la ubicación GPS física es del viaje (VRPTW).
 */
function lastKnownPositionKey(tripId: string): string {
  return `position:last:${tripId}`;
}

/**
 * Claim del tramo de cadencia (AC4 de MOVO-202, rehecho por AC2 de MOVO-250, adaptado por MOVO-251):
 * un tramo es `floor(capturedAt / 45s)` por VIAJE (`tripId`), no por envío, para evitar duplicar
 * filas cuando el transportista lleva múltiples envíos consolidados.
 */
function persistCadenceBucketKey(tripId: string, bucket: number): string {
  return `position:cadence:${tripId}:${bucket}`;
}

/**
 * MOVO-250/AC1: actualiza la "última posición conocida" solo si `capturedAt` es
 * estrictamente posterior a la guardada -- un script Lua porque leer + comparar +
 * escribir por separado deja pasar a dos reportes solapados (mismo criterio que el fix
 * de cadencia de la PR #178). Devuelve 1 si actualizó, 0 si la guardada era igual o más
 * reciente. Un hash sin `capturedAtMs` (escrito antes de este ticket) se pisa.
 */
export const UPDATE_LAST_KNOWN_IF_NEWER_SCRIPT = `
local prev = redis.call('HGET', KEYS[1], 'capturedAtMs')
if prev and tonumber(prev) >= tonumber(ARGV[1]) then
  return 0
end
redis.call('HSET', KEYS[1], 'capturedAtMs', ARGV[1], 'lat', ARGV[2], 'lng', ARGV[3], 'accuracyM', ARGV[4], 'capturedAt', ARGV[5], 'recordedAt', ARGV[6])
redis.call('EXPIRE', KEYS[1], ARGV[7])
return 1
`;

/** MOVO-240: radio del aviso "está por llegar", en línea recta (Haversine). Se eligió radio
 * y no ETA porque el ETA exigiría una llamada facturable a Routes por cada aviso. */
export const PROXIMITY_RADIUS_KM = 2;

/** Un aviso por envío y etapa; 7 días cubren de sobra cualquier viaje. */
const PROXIMITY_CLAIM_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function proximityClaimKey(stage: "pickup" | "delivery", shipmentId: string): string {
  return `notified:proximity:${stage}:${shipmentId}`;
}

export interface RealtimePublisher {
  broadcast(shipmentId: string, message: unknown): void;
}

/**
 * Subconjunto de `ioredis#Redis` que este servicio necesita -- mismo criterio que
 * `HandshakeRedisClient` (`handshake.service.ts`, MOVO-158): una interfaz angosta,
 * no el cliente completo, para que los tests puedan fakear un Map en memoria en vez
 * de levantar Redis real o mockear una librería entera. `app.redis` (ioredis real)
 * la satisface estructuralmente sin ningún adapter.
 */
export interface PositionRedisClient {
  set(key: string, value: string, mode: "PX", ttlMs: number, flag: "NX"): Promise<"OK" | null>;
  del(key: string): Promise<number>;
  hget(key: string, field: string): Promise<string | null>;
  hgetall(key: string): Promise<Record<string, string>>;
  /** Solo se usa con `UPDATE_LAST_KNOWN_IF_NEWER_SCRIPT`. */
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
}

export interface ReportPositionInput {
  lat: number;
  lng: number;
  accuracyM: number;
  capturedAt: Date;
  /** MOVO-270: flag `mocked` de expo-location (solo Android). Se acepta y difunde, pero una
   * posición simulada nunca cuenta como evidencia del retiro. */
  mocked?: boolean;
}

export interface BatchPositionInput extends ReportPositionInput {
  shipmentId: string;
}

/** MOVO-250/AC4 y MOVO-251: motivos de rechazo por ítem del lote. */
export type PositionRejectionCode =
  | "SHIPMENT_NOT_TRACKABLE"
  | "SHIPMENT_NOT_IN_TRANSIT"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "INVALID_CAPTURED_AT";

export type PositionBatchItemResult =
  | { index: number; shipmentId: string; status: "accepted"; persisted: boolean }
  | { index: number; shipmentId: string; status: "rejected"; code: PositionRejectionCode };

export interface PositionServiceLogger {
  info?: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error?: (obj: unknown, msg?: string) => void;
}

export interface PositionService {
  reportPosition(shipmentId: string, callerId: string, input: ReportPositionInput): Promise<{ persisted: boolean }>;
  reportPositions(callerId: string, items: BatchPositionInput[]): Promise<PositionBatchItemResult[]>;
  getLastKnownPosition(shipmentId: string): Promise<LastKnownCarrierPosition | null>;
  purgeExpiredPositions(retentionDays: number): Promise<number>;
  deletePositionsForCarrier(carrierId: string): Promise<number>;
}

export function createPositionService(
  shipmentRepository: ShipmentRepository,
  positionRepository: PositionRepository,
  redis: PositionRedisClient,
  realtime: RealtimePublisher,
  logger?: PositionServiceLogger,
  /** MOVO-240: sin cliente no se evalúa la proximidad (lectura de tracking, purga). */
  notificationsClient?: NotificationsClient,
  /** MOVO-270: sin repositorio no se registra la evidencia del retiro (lectura de tracking, purga). */
  pickupEvidenceRepository?: PickupEvidenceRepository
): PositionService {
  async function resolveTrackingContext(shipmentId: string): Promise<ShipmentTrackingContext | null> {
    if (shipmentRepository.findTrackingContext) {
      return shipmentRepository.findTrackingContext(shipmentId);
    }
    const shipment = await shipmentRepository.findById(shipmentId);
    if (!shipment) return null;
    return {
      shipment,
      trip: {
        id: "trip-default",
        status: TripStatus.ACTIVE,
        carrierId: shipment.carrierId ?? "",
      },
      activeShipmentIds: [shipment.id],
    };
  }

  /**
   * MOVO-251: autorización para reportar posición pasa a validar el Trip, no el Shipment aislado.
   * Se acepta si:
   * (a) el Trip asociado está en active (MOVO-221), y
   * (b) el shipmentId reportado pertenece a ese viaje (oferta accepted).
   * El Shipment.status se acepta en assigned e in_transit; se rechaza en delivered y estados terminales.
   */
  function assertCanReport(
    context: ShipmentTrackingContext | null,
    callerId: string,
    capturedAt: Date,
    now: Date
  ): ShipmentTrackingContext & { trip: NonNullable<ShipmentTrackingContext["trip"]> } {
    if (!context || !context.shipment) {
      throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");
    }
    const { shipment, trip } = context;
    assertIsCarrier(shipment, callerId);

    if (!TRACKABLE_SHIPMENT_STATUSES.includes(shipment.status)) {
      throw new ApiError(
        403,
        "SHIPMENT_NOT_TRACKABLE",
        "El envío ya no se encuentra en un estado trackeable."
      );
    }

    if (!trip || trip.status !== TripStatus.ACTIVE) {
      throw new ApiError(
        403,
        "SHIPMENT_NOT_TRACKABLE",
        trip
          ? `El viaje asociado al envío no está activo (estado actual: '${trip.status}').`
          : "El envío no tiene un viaje asociado para reportar posiciones."
      );
    }

    const capturedMs = capturedAt.getTime();
    // `lastStatusChangedAt` mantiene el instante en que entró al estado actual.
    const statusSince = shipment.lastStatusChangedAt?.getTime();
    if (
      capturedMs > now.getTime() + CAPTURED_AT_CLOCK_SKEW_TOLERANCE_MS ||
      (statusSince !== undefined && capturedMs < statusSince - CAPTURED_AT_CLOCK_SKEW_TOLERANCE_MS)
    ) {
      throw new ApiError(
        422,
        "INVALID_CAPTURED_AT",
        "La fecha de captura está en el futuro o es anterior al inicio del tránsito."
      );
    }
    return context as ShipmentTrackingContext & { trip: NonNullable<ShipmentTrackingContext["trip"]> };
  }

  /**
   * MOVO-240: avisa "está por llegar" al emisor cuando el transportista entra a 2 km del
   * retiro (envío `assigned`) y al receptor cuando entra a 2 km de la entrega
   * (`in_transit`). Recorre todos los envíos activos del viaje: el aviso puede salir aunque
   * no sea la próxima parada (decisión del refinamiento, el orden del VRPTW no se persiste).
   * Una sola vez por envío y etapa (`SET NX`); si el push falla se libera para reintentar.
   *
   * Cada envío se relee justo antes de decidir (nada cacheado entre posiciones), así un envío
   * que se entregó o canceló mientras tanto no recibe un "ya llega". Un fallo leyendo o avisando
   * un envío no corta la evaluación de los demás.
   */
  async function notifyProximity(context: ShipmentTrackingContext, position: ReportPositionInput): Promise<void> {
    if (!notificationsClient) return;
    const ids = context.activeShipmentIds?.length ? context.activeShipmentIds : [context.shipment.id];
    for (const id of ids) {
      try {
        const shipment = await shipmentRepository.findById(id);
        if (shipment) await notifyShipmentProximity(shipment, position);
      } catch (err) {
        logger?.warn({ err, event: "proximity_check_failed", shipmentId: id }, "Falló la evaluación de proximidad");
      }
    }
  }

  async function notifyShipmentProximity(shipment: Shipment, position: ReportPositionInput): Promise<void> {
    if (!notificationsClient) return;
    const target =
      shipment.status === ShipmentStatus.ASSIGNED
        ? {
            stage: "pickup" as const,
            userId: shipment.senderId,
            lat: shipment.pickupLat,
            lng: shipment.pickupLng,
            trigger: "carrierNearPickup" as const,
          }
        : shipment.status === ShipmentStatus.IN_TRANSIT && shipment.receiverId
          ? {
              stage: "delivery" as const,
              userId: shipment.receiverId,
              lat: shipment.deliveryLat,
              lng: shipment.deliveryLng,
              trigger: "carrierNearDelivery" as const,
            }
          : null;
    if (!target) return;
    if (haversineKm(position.lat, position.lng, target.lat, target.lng) > PROXIMITY_RADIUS_KM) return;
    // Con retiro y entrega a menos de 2 km, el receptor recibiría "ya llega" apenas se retira el
    // paquete: la entrega se avisa recién cuando el transportista salió del radio del retiro. Un
    // envío con las dos direcciones tan cerca puede quedarse sin este aviso; el push de custodia
    // del retiro ya le dijo al receptor que el paquete salió.
    if (
      target.stage === "delivery" &&
      haversineKm(position.lat, position.lng, shipment.pickupLat, shipment.pickupLng) <= PROXIMITY_RADIUS_KM
    ) {
      return;
    }

    const claimKey = proximityClaimKey(target.stage, shipment.id);
    if ((await redis.set(claimKey, "1", "PX", PROXIMITY_CLAIM_TTL_MS, "NX")) !== "OK") return;

    const { title, body } = renderNotificationTrigger(target.trigger, undefined);
    try {
      await notificationsClient.sendPush({
        userId: target.userId,
        title,
        body,
        category: notificationTriggerCategory(target.trigger),
        data: { type: "carrier_nearby", shipmentId: shipment.id },
      });
    } catch (err) {
      await redis.del(claimKey).catch(() => undefined);
      logger?.warn(
        { err, event: "notification_dispatch_failed", shipmentId: shipment.id, stage: target.stage },
        "No se pudo mandar el aviso de transportista cerca"
      );
    }
  }

  /** Fire-and-forget: la ingesta nunca espera al push ni falla por él. Las evaluaciones corren
   * una detrás de otra, así un lote no abre N lecturas en paralelo contra la base. */
  function scheduleProximity(evaluations: Array<{ context: ShipmentTrackingContext; position: ReportPositionInput }>): void {
    if (!notificationsClient || evaluations.length === 0) return;
    void (async () => {
      for (const { context, position } of evaluations) {
        await notifyProximity(context, position);
      }
    })().catch((err: unknown) => {
      logger?.warn({ err, event: "proximity_check_failed" }, "Falló la evaluación de proximidad");
    });
  }

  /**
   * MOVO-270 (ADR-052, AC4/AC8): clasifica la posición contra el retiro de cada envío `assigned`
   * del viaje y la suma a su `pickup_evidence`. A diferencia del aviso de proximidad, corre por
   * CADA tramo de 45s con claim, incluidas las posiciones viejas de una cola offline: una llegada
   * encolada mientras no había señal tiene que contar igual. Cada envío se relee (nada cacheado) y
   * solo suma si sigue asignado al transportista que reportó: una escritura tardía de quien se bajó
   * no contamina la asignación siguiente. Corre en línea con la ingesta y propaga el fallo: el
   * caller libera el claim del tramo y el cliente reintenta, así el barrido nunca decide sin una
   * evidencia que ya se había aceptado.
   */
  async function recordPickupEvidence(
    context: ShipmentTrackingContext,
    position: ReportPositionInput,
    carrierId: string | null
  ): Promise<void> {
    if (!pickupEvidenceRepository || !carrierId) return;
    const ids = context.activeShipmentIds?.length ? context.activeShipmentIds : [context.shipment.id];
    for (const id of ids) {
      const shipment = await shipmentRepository.findById(id);
      if (!shipment || shipment.status !== ShipmentStatus.ASSIGNED || shipment.carrierId !== carrierId) continue;
      const evidence = classifyPickupPosition(shipment, position);
      if (!evidence) continue;
      const arrived = await pickupEvidenceRepository.record(id, carrierId, evidence, {
        arrivedAt: position.capturedAt,
        lat: position.lat,
        lng: position.lng,
        accuracyM: position.accuracyM,
      });
      if (arrived) {
        logger?.info?.({ event: "carrier_arrived_pickup", shipmentId: id, accuracyM: position.accuracyM }, "Llegada del transportista al retiro registrada");
      }
    }
  }

  /**
   * MOVO-270 (AC2): a qué envío se asocia una fila de traza. Solo se guarda con custodia: el
   * reportado si está `in_transit`, si no el primer `in_transit` del viaje; `null` si el viaje solo
   * tiene envíos `assigned` (la posición se difunde pero no se escribe). La lectura para disputas
   * va por `trip_id` + rango de custodia, así que la fila no tiene que ser del envío reportado.
   */
  function persistenceTarget(context: ShipmentTrackingContext): string | null {
    const ids =
      context.persistableShipmentIds ??
      (POSITION_PERSISTABLE_SHIPMENT_STATUSES.includes(context.shipment.status) ? [context.shipment.id] : []);
    if (ids.includes(context.shipment.id)) return context.shipment.id;
    return ids[0] ?? null;
  }

  /**
   * AC4/AC5 de MOVO-202 con el orden de MOVO-250 y agrupamiento por viaje de MOVO-251.
   * La cadencia se decide con un claim atómico por TRAMO de `capturedAt` (`SET NX`) en Redis por `tripId`.
   * La última posición conocida se indexa por `tripId` y la difusión llega a los envíos activos del viaje.
   * MOVO-270: el claim marca el tramo como evaluado aunque no se escriba (viaje solo con envíos
   * `assigned`); si un envío pasa a `in_transit` a mitad del tramo, se guarda desde el siguiente.
   */
  async function ingest(
    context: ShipmentTrackingContext & { trip: NonNullable<ShipmentTrackingContext["trip"]> },
    input: ReportPositionInput,
    now: Date
  ): Promise<{ persisted: boolean; evaluateProximity: boolean }> {
    const shipmentId = context.shipment.id;
    const tripId = context.trip.id;
    const activeShipmentIds = context.activeShipmentIds;
    const bucket = Math.floor(input.capturedAt.getTime() / CARRIER_POSITION_MIN_PERSIST_INTERVAL_MS);
    const cadenceKey = persistCadenceBucketKey(tripId, bucket);
    const claimed = await redis.set(cadenceKey, "1", "PX", CADENCE_BUCKET_TTL_MS, "NX");
    const claimedBucket = claimed === "OK";
    const targetShipmentId = claimedBucket ? persistenceTarget(context) : null;

    if (claimedBucket) {
      try {
        await recordPickupEvidence(context, input, context.shipment.carrierId);
      } catch (err) {
        await redis.del(cadenceKey).catch((delErr: unknown) => {
          logger?.warn({ err: delErr, tripId, shipmentId }, "No se pudo liberar el claim de cadencia tras fallar la evidencia del retiro");
        });
        throw err;
      }
    }

    if (targetShipmentId) {
      try {
        await positionRepository.create({
          shipmentId: targetShipmentId,
          tripId,
          lat: input.lat,
          lng: input.lng,
          accuracyM: input.accuracyM,
          capturedAt: input.capturedAt,
          mocked: input.mocked,
        });
      } catch (err) {
        await redis.del(cadenceKey).catch((delErr: unknown) => {
          logger?.warn({ err: delErr, tripId, shipmentId }, "No se pudo liberar el claim de cadencia tras un create fallido");
        });
        throw err;
      }
    }

    const updated = await redis.eval(
      UPDATE_LAST_KNOWN_IF_NEWER_SCRIPT,
      1,
      lastKnownPositionKey(tripId),
      String(input.capturedAt.getTime()),
      String(input.lat),
      String(input.lng),
      String(input.accuracyM),
      input.capturedAt.toISOString(),
      now.toISOString(),
      String(LAST_KNOWN_POSITION_TTL_SECONDS)
    );

    const advanced = Number(updated) === 1;
    if (advanced) {
      const targets = activeShipmentIds && activeShipmentIds.length > 0 ? activeShipmentIds : [shipmentId];
      for (const targetId of targets) {
        realtime.broadcast(targetId, {
          type: "position",
          shipmentId: targetId,
          lat: input.lat,
          lng: input.lng,
          accuracyM: input.accuracyM,
          capturedAt: input.capturedAt.toISOString(),
          recordedAt: now.toISOString(),
        });
      }
    }

    // MOVO-240: la proximidad se evalúa solo con una posición nueva (avanzó el marcador) que
    // además abrió un tramo de 45s -- deja afuera las posiciones viejas de la cola offline y
    // limita la evaluación a una por tramo. La dispara el caller (`scheduleProximity`).
    return {
      persisted: targetShipmentId !== null,
      evaluateProximity: claimedBucket && advanced,
    };
  }

  return {
    async reportPosition(
      shipmentId: string,
      callerId: string,
      input: ReportPositionInput
    ): Promise<{ persisted: boolean }> {
      const context = await resolveTrackingContext(shipmentId);
      const now = new Date();
      const valid = assertCanReport(context, callerId, input.capturedAt, now);
      const { persisted, evaluateProximity } = await ingest(valid, input, now);
      if (evaluateProximity) scheduleProximity([{ context: valid, position: input }]);
      return { persisted };
    },

    async reportPositions(callerId: string, items: BatchPositionInput[]): Promise<PositionBatchItemResult[]> {
      const now = new Date();
      const contexts = new Map<string, Promise<ShipmentTrackingContext | null>>();
      // Una sola evaluación de proximidad por viaje y por lote, con la posición más reciente:
      // una cola offline vaciada de golpe no dispara una evaluación por tramo.
      const proximityByTrip = new Map<string, { context: ShipmentTrackingContext; position: ReportPositionInput }>();
      const results: PositionBatchItemResult[] = [];

      for (const [index, item] of items.entries()) {
        let lookup = contexts.get(item.shipmentId);
        if (!lookup) {
          lookup = resolveTrackingContext(item.shipmentId);
          contexts.set(item.shipmentId, lookup);
        }

        let valid: ShipmentTrackingContext & { trip: NonNullable<ShipmentTrackingContext["trip"]> };
        try {
          valid = assertCanReport(await lookup, callerId, item.capturedAt, now);
        } catch (err) {
          const code = toRejectionCode(err);
          if (!code) throw err;
          results.push({ index, shipmentId: item.shipmentId, status: "rejected", code });
          continue;
        }

        const { persisted, evaluateProximity } = await ingest(valid, item, now);
        results.push({ index, shipmentId: item.shipmentId, status: "accepted", persisted });
        const previous = proximityByTrip.get(valid.trip.id);
        if (evaluateProximity && (!previous || previous.position.capturedAt < item.capturedAt)) {
          proximityByTrip.set(valid.trip.id, { context: valid, position: item });
        }
      }

      scheduleProximity([...proximityByTrip.values()]);
      return results;
    },

    async getLastKnownPosition(shipmentId: string): Promise<LastKnownCarrierPosition | null> {
      const context = await resolveTrackingContext(shipmentId);
      if (!context || !context.shipment) return null;

      // MOVO-251/AC5: un envío que sale del viaje o no está en estado trackeable deja de resolver posición
      if (!TRACKABLE_SHIPMENT_STATUSES.includes(context.shipment.status)) {
        return null;
      }

      if (!context.trip || context.trip.status !== TripStatus.ACTIVE) {
        return null;
      }

      const raw = await redis.hgetall(lastKnownPositionKey(context.trip.id));
      if (!raw || !raw.lat) return null;
      return {
        lat: Number(raw.lat),
        lng: Number(raw.lng),
        accuracyM: Number(raw.accuracyM),
        capturedAt: raw.capturedAt,
        recordedAt: raw.recordedAt,
      };
    },

    async purgeExpiredPositions(retentionDays: number): Promise<number> {
      const deleted = await positionRepository.purgeEligibleClosedShipments(new Date(), retentionDays);
      if (deleted > 0) {
        logger?.info?.({ deleted, retentionDays, event: "carrier_positions_purged" }, "Purga de posiciones GPS");
      }
      return deleted;
    },

    async deletePositionsForCarrier(carrierId: string): Promise<number> {
      return positionRepository.deleteAllForCarrier(carrierId);
    },
  };
}

function toRejectionCode(err: unknown): PositionRejectionCode | null {
  if (!(err instanceof ApiError)) return null;
  switch (err.code) {
    case "NOT_FOUND":
      return "NOT_FOUND";
    case "AUTH_FORBIDDEN":
      return "FORBIDDEN";
    case "SHIPMENT_NOT_TRACKABLE":
    case "SHIPMENT_NOT_IN_TRANSIT":
    case "INVALID_CAPTURED_AT":
      return err.code as PositionRejectionCode;
    default:
      return null;
  }
}

export type { CarrierPosition };
