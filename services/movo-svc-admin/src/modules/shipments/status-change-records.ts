import type { FastifyBaseLogger } from "fastify";
import type Redis from "ioredis";
import type { ChangeShipmentStatusResponse } from "@movo/shared";

/**
 * MOVO-332 (DD-055): lo que `svc-admin` recuerda de un cambio de estado por `idempotencyKey`, para que un reintento
 * del panel (doble clic, timeout de 30 s) no vuelva a pasar por las validaciones ni por el segundo factor.
 *
 * - `done`: el cambio se aplicó; el reintento devuelve la misma respuesta con `replayed: true`.
 * - `unknown`: `svc-shipments` no respondió y el cambio pudo haberse aplicado. El segundo factor ya se gastó, así que el
 *   reintento no lo vuelve a pedir ni compara `expectedStatus` (el envío puede estar ya en el destino): vuelve a
 *   `svc-shipments`, que resuelve el replay con la misma clave (su idempotencia va antes que su `expectedStatus`).
 *
 * La clave incluye admin y envío: la misma `idempotencyKey` de otro admin u otro envío no choca con esta.
 */
export interface StatusChangeRecord {
  state: "done" | "unknown";
  targetStatus: string;
  expectedStatus: string;
  response?: ChangeShipmentStatusResponse;
}

const TTL_SECONDS = 24 * 60 * 60;

export function createStatusChangeRecords(redis: Redis, logger: FastifyBaseLogger) {
  const keyOf = (adminId: string, shipmentId: string, idempotencyKey: string) =>
    `admin-status-change:idem:${adminId}:${shipmentId}:${idempotencyKey}`;

  return {
    async read(adminId: string, shipmentId: string, idempotencyKey: string): Promise<StatusChangeRecord | null> {
      const raw = await redis.get(keyOf(adminId, shipmentId, idempotencyKey));
      if (!raw) return null;
      try {
        return JSON.parse(raw) as StatusChangeRecord;
      } catch {
        return null;
      }
    },

    /** Best-effort: el cambio ya está hecho, un Redis caído no puede convertirlo en un error para el panel. */
    async save(adminId: string, shipmentId: string, idempotencyKey: string, record: StatusChangeRecord): Promise<void> {
      try {
        await redis.set(keyOf(adminId, shipmentId, idempotencyKey), JSON.stringify(record), "EX", TTL_SECONDS);
      } catch (err) {
        logger.warn({ err, event: "status_change_record_save_failed", shipmentId }, "No se pudo guardar la clave de idempotencia");
      }
    },
  };
}
