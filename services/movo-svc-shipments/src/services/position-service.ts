import { ApiError, ShipmentStatus } from "@movo/shared";
import { ShipmentRepository } from "../repositories/shipment-repository";
import { PositionRepository } from "../repositories/position-repository";
import { assertIsCarrier } from "../modules/shipments/assert-shipment-access";
import { CarrierPosition, LastKnownCarrierPosition } from "../models/carrier-position";

/**
 * MOVO-202/AC4: cadencia de persistencia en Postgres. Constante, no env var -- es una
 * regla de producto fija ("cada ~45s"), no un parámetro que valga ajustar por
 * ambiente (a diferencia de los intervalos de los sweeps, que sí son operativos).
 * Exportada para que el test de cadencia del DoD la use en vez de hardcodear 45000 de
 * nuevo.
 */
export const CARRIER_POSITION_MIN_PERSIST_INTERVAL_MS = 45_000;

/** TTL del hash de "última posición conocida" en Redis -- puramente defensivo: en el
 * flujo normal el tracking se corta (MOVO-201/AC4) mucho antes de esto, así que esta
 * key nunca debería sobrevivir tanto. Acota igual el peor caso (un envío que se cae
 * de la máquina de estados sin que nadie lo note) en vez de dejar la key viva para
 * siempre -- mismo espíritu de minimización de datos que el resto de este ticket. */
const LAST_KNOWN_POSITION_TTL_SECONDS = 7 * 24 * 60 * 60;

function lastKnownPositionKey(shipmentId: string): string {
  return `position:last:${shipmentId}`;
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
  hget(key: string, field: string): Promise<string | null>;
  hset(key: string, fields: Record<string, string>): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  hgetall(key: string): Promise<Record<string, string>>;
}

export interface ReportPositionInput {
  lat: number;
  lng: number;
  accuracyM: number;
  capturedAt: Date;
}

export interface PositionServiceLogger {
  info?: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error?: (obj: unknown, msg?: string) => void;
}

export interface PositionService {
  reportPosition(shipmentId: string, callerId: string, input: ReportPositionInput): Promise<{ persisted: boolean }>;
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
  return {
    /**
     * AC1-AC5. Autorización estricta (AC2: solo el transportista asignado, solo
     * `in_transit`, 403 para cualquier otro actor o estado -- literal del ticket, no
     * el 409 que sería más habitual para "estado equivocado"). El descarte de
     * cadencia (AC4) se decide contra `lastPersistedAt` en Redis, nunca confiando en
     * que el cliente respete los ~45s -- la última posición conocida (AC3) y la
     * difusión (AC5) pasan SIEMPRE, sin importar si esta posición puntual se persiste.
     */
    async reportPosition(
      shipmentId: string,
      callerId: string,
      input: ReportPositionInput
    ): Promise<{ persisted: boolean }> {
      const shipment = await shipmentRepository.findById(shipmentId);
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

      const now = new Date();
      const key = lastKnownPositionKey(shipmentId);
      const lastPersistedAtRaw = await redis.hget(key, "lastPersistedAt");
      const lastPersistedAt = lastPersistedAtRaw ? new Date(lastPersistedAtRaw) : null;
      const shouldPersist =
        !lastPersistedAt || now.getTime() - lastPersistedAt.getTime() >= CARRIER_POSITION_MIN_PERSIST_INTERVAL_MS;

      if (shouldPersist) {
        await positionRepository.create({
          shipmentId,
          lat: input.lat,
          lng: input.lng,
          accuracyM: input.accuracyM,
          capturedAt: input.capturedAt,
        });
      }

      // AC3: la última posición conocida se actualiza SIEMPRE, independientemente de
      // si esta se persistió -- `lastPersistedAt` solo se pisa cuando sí se persistió,
      // es la única marca que gobierna la cadencia de arriba.
      const hashUpdate: Record<string, string> = {
        lat: String(input.lat),
        lng: String(input.lng),
        accuracyM: String(input.accuracyM),
        capturedAt: input.capturedAt.toISOString(),
        recordedAt: now.toISOString(),
      };
      if (shouldPersist) {
        hashUpdate.lastPersistedAt = now.toISOString();
      }
      await redis.hset(key, hashUpdate);
      await redis.expire(key, LAST_KNOWN_POSITION_TTL_SECONDS);

      // AC5: se difunde cada posición recibida, sin esperar la persistencia.
      realtime.broadcast(shipmentId, {
        type: "position",
        shipmentId,
        lat: input.lat,
        lng: input.lng,
        accuracyM: input.accuracyM,
        capturedAt: input.capturedAt.toISOString(),
        recordedAt: now.toISOString(),
      });

      return { persisted: shouldPersist };
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

export type { CarrierPosition };
