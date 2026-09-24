import { ApiError, ShipmentStatus } from "@movo/shared";
import { ShipmentRepository } from "../repositories/shipment-repository";
import { PositionRepository } from "../repositories/position-repository";
import { assertIsCarrier } from "../modules/shipments/assert-shipment-access";
import { CarrierPosition, LastKnownCarrierPosition } from "../models/carrier-position";
import { Shipment } from "../models/shipment";

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

function lastKnownPositionKey(shipmentId: string): string {
  return `position:last:${shipmentId}`;
}

/**
 * Claim del tramo de cadencia (AC4 de MOVO-202, rehecho por AC2 de MOVO-250): un tramo es
 * `floor(capturedAt / 45s)`, no una ventana móvil desde la hora de llegada -- así el
 * resultado no depende del orden en que llegan las posiciones y se pueden completar
 * tramos atrasados al vaciar una cola offline.
 */
function persistCadenceBucketKey(shipmentId: string, bucket: number): string {
  return `position:cadence:${shipmentId}:${bucket}`;
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
}

export interface BatchPositionInput extends ReportPositionInput {
  shipmentId: string;
}

/** MOVO-250/AC4: motivos de rechazo por ítem del lote. */
export type PositionRejectionCode = "SHIPMENT_NOT_IN_TRANSIT" | "NOT_FOUND" | "FORBIDDEN" | "INVALID_CAPTURED_AT";

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
  logger?: PositionServiceLogger
): PositionService {
  /** AC2 de MOVO-202 (autorización estricta: solo el transportista asignado, solo
   * `in_transit`, 403 para cualquier otro actor o estado -- literal del ticket, no el
   * 409 que sería más habitual para "estado equivocado") + AC3 de MOVO-250 (`capturedAt`
   * plausible). Lanza `ApiError`; el lote lo traduce a un código por ítem. */
  function assertCanReport(shipment: Shipment | null, callerId: string, capturedAt: Date, now: Date): Shipment {
    if (!shipment) {
      throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");
    }
    assertIsCarrier(shipment, callerId);
    if (shipment.status !== ShipmentStatus.IN_TRANSIT) {
      throw new ApiError(
        403,
        "SHIPMENT_NOT_IN_TRANSIT",
        "Solo se pueden reportar posiciones mientras el envío está en tránsito."
      );
    }
    const capturedMs = capturedAt.getTime();
    // `lastStatusChangedAt` es, mientras el envío está `in_transit`, el instante en que
    // pasó a ese estado (lo mantiene cada escritor de `status`).
    const inTransitSince = shipment.lastStatusChangedAt?.getTime();
    if (
      capturedMs > now.getTime() + CAPTURED_AT_CLOCK_SKEW_TOLERANCE_MS ||
      (inTransitSince !== undefined && capturedMs < inTransitSince - CAPTURED_AT_CLOCK_SKEW_TOLERANCE_MS)
    ) {
      throw new ApiError(
        422,
        "INVALID_CAPTURED_AT",
        "La fecha de captura está en el futuro o es anterior al inicio del tránsito."
      );
    }
    return shipment;
  }

  /**
   * AC4/AC5 de MOVO-202 con el orden de MOVO-250. La cadencia se decide con un claim
   * atómico por TRAMO de `capturedAt` (`SET NX`) en Redis, nunca confiando en que el
   * cliente respete los ~45s. La última posición conocida (AC1) y la difusión pasan solo
   * si `capturedAt` es más reciente que la guardada: una posición vieja entra a la traza
   * pero no mueve el marcador.
   */
  async function ingest(shipmentId: string, input: ReportPositionInput, now: Date): Promise<{ persisted: boolean }> {
    // El TTL del claim no es la ventana, es el tiempo que el tramo queda "ocupado": no es
    // un lock alrededor de la escritura (que podría vencer a mitad de un `create` lento)
    // y no se libera al terminar, solo si el `create` falla.
    const bucket = Math.floor(input.capturedAt.getTime() / CARRIER_POSITION_MIN_PERSIST_INTERVAL_MS);
    const cadenceKey = persistCadenceBucketKey(shipmentId, bucket);
    const claimed = await redis.set(cadenceKey, "1", "PX", CADENCE_BUCKET_TTL_MS, "NX");
    const shouldPersist = claimed === "OK";

    if (shouldPersist) {
      try {
        await positionRepository.create({
          shipmentId,
          lat: input.lat,
          lng: input.lng,
          accuracyM: input.accuracyM,
          capturedAt: input.capturedAt,
        });
      } catch (err) {
        // Si la escritura falló, no quedó nada persistido: se libera el claim para que
        // el próximo reporte del tramo pueda reintentar en vez de perder esa traza.
        // Best-effort -- si el `del` también falla, el claim expira solo por TTL.
        await redis.del(cadenceKey).catch((delErr: unknown) => {
          logger?.warn({ err: delErr, shipmentId }, "No se pudo liberar el claim de cadencia tras un create fallido");
        });
        throw err;
      }
    }

    const updated = await redis.eval(
      UPDATE_LAST_KNOWN_IF_NEWER_SCRIPT,
      1,
      lastKnownPositionKey(shipmentId),
      String(input.capturedAt.getTime()),
      String(input.lat),
      String(input.lng),
      String(input.accuracyM),
      input.capturedAt.toISOString(),
      now.toISOString(),
      String(LAST_KNOWN_POSITION_TTL_SECONDS)
    );

    if (Number(updated) === 1) {
      realtime.broadcast(shipmentId, {
        type: "position",
        shipmentId,
        lat: input.lat,
        lng: input.lng,
        accuracyM: input.accuracyM,
        capturedAt: input.capturedAt.toISOString(),
        recordedAt: now.toISOString(),
      });
    }

    return { persisted: shouldPersist };
  }

  return {
    async reportPosition(
      shipmentId: string,
      callerId: string,
      input: ReportPositionInput
    ): Promise<{ persisted: boolean }> {
      const shipment = await shipmentRepository.findById(shipmentId);
      const now = new Date();
      assertCanReport(shipment, callerId, input.capturedAt, now);
      return ingest(shipmentId, input, now);
    },

    /**
     * MOVO-250/AC4: resultado por ítem, no todo-o-nada -- el mobile necesita saber qué
     * descartar de su cola y qué envío dejar de trackear. Los ítems se procesan en
     * orden; reintentar un lote completo es seguro (los tramos ya persistidos no se
     * duplican y la última posición nunca retrocede).
     */
    async reportPositions(callerId: string, items: BatchPositionInput[]): Promise<PositionBatchItemResult[]> {
      const now = new Date();
      // Un lote suele repetir pocos envíos: una lectura por envío distinto, no por ítem.
      const shipments = new Map<string, Promise<Shipment | null>>();
      const results: PositionBatchItemResult[] = [];

      for (const [index, item] of items.entries()) {
        let lookup = shipments.get(item.shipmentId);
        if (!lookup) {
          lookup = shipmentRepository.findById(item.shipmentId);
          shipments.set(item.shipmentId, lookup);
        }

        try {
          assertCanReport(await lookup, callerId, item.capturedAt, now);
        } catch (err) {
          const code = toRejectionCode(err);
          if (!code) throw err;
          results.push({ index, shipmentId: item.shipmentId, status: "rejected", code });
          continue;
        }

        const { persisted } = await ingest(item.shipmentId, item, now);
        results.push({ index, shipmentId: item.shipmentId, status: "accepted", persisted });
      }

      return results;
    },

    /** AC3: para que `tracking.routes.ts` empuje la última posición conocida apenas
     * se conecta un suscriptor nuevo, sin esperar el próximo reporte real. */
    async getLastKnownPosition(shipmentId: string): Promise<LastKnownCarrierPosition | null> {
      const raw = await redis.hgetall(lastKnownPositionKey(shipmentId));
      if (!raw || !raw.lat) return null;
      return {
        lat: Number(raw.lat),
        lng: Number(raw.lng),
        accuracyM: Number(raw.accuracyM),
        capturedAt: raw.capturedAt,
        recordedAt: raw.recordedAt,
      };
    },

    /** AC6: corrido por el sweep periódico (`carrier-position-purge-sweep.ts`). */
    async purgeExpiredPositions(retentionDays: number): Promise<number> {
      const deleted = await positionRepository.purgeEligibleClosedShipments(new Date(), retentionDays);
      if (deleted > 0) {
        logger?.info?.({ deleted, retentionDays, event: "carrier_positions_purged" }, "Purga de posiciones GPS");
      }
      return deleted;
    },

    /** AC7: supresión de cuenta (MOVO-39) -- ver `account-deletion.routes.ts`. */
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
    case "SHIPMENT_NOT_IN_TRANSIT":
    case "INVALID_CAPTURED_AT":
      return err.code;
    default:
      return null;
  }
}

export type { CarrierPosition };
