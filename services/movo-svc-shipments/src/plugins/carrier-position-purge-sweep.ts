import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import { createShipmentRepository } from "../repositories/shipment-repository";
import { createPositionRepository } from "../repositories/position-repository";
import { createPositionService } from "../services/position-service";

export interface CarrierPositionPurgeSweepPluginOptions {
  enabled?: boolean;
}

/**
 * MOVO-202/AC6: borra periódicamente las posiciones GPS de envíos que ya llevan más
 * de `CARRIER_POSITION_RETENTION_DAYS` días cerrados (ADR-023) -- mismo esqueleto
 * `setInterval` + lock distribuido en Redis que el resto de los sweeps del servicio
 * (`pickup-expiry-sweep.ts`/`receiver-confirmation-sweep.ts`). Un envío `disputed`
 * nunca es candidato mientras siga en ese estado -- ver el comentario de
 * `POSITION_PURGE_ELIGIBLE_STATUSES` (`domain/shipment-state-machine.ts`).
 */
export default fp(async (app: FastifyInstance, opts: CarrierPositionPurgeSweepPluginOptions = {}) => {
  const isEnabled = opts.enabled ?? app.config.CARRIER_POSITION_PURGE_SWEEP_ENABLED ?? true;
  const intervalMinutes = app.config.CARRIER_POSITION_PURGE_SWEEP_INTERVAL_MINUTES;
  const retentionDays = app.config.CARRIER_POSITION_RETENTION_DAYS;

  if (!isEnabled || intervalMinutes <= 0) {
    app.log.info("Carrier position purge sweep plugin está desactivado.");
    return;
  }

  const shipmentRepository = createShipmentRepository(app.db);
  const positionRepository = createPositionRepository(app.db);
  // Sin `RealtimePublisher` real: el sweep nunca reporta posiciones, así que nunca
  // llama a `reportPosition`/`broadcast` -- un stub alcanza para satisfacer el tipo.
  const service = createPositionService(shipmentRepository, positionRepository, app.redis, { broadcast() {} }, app.log);

  const intervalMs = intervalMinutes * 60 * 1000;
  const lockTtlMs = Math.max(10_000, Math.floor(intervalMs * 0.8));
  const lockKey = "locks:carrier-position-purge-sweep";

  const runSweep = async () => {
    try {
      const acquired = await app.redis.set(lockKey, "locked", "PX", lockTtlMs, "NX");
      if (acquired !== "OK") {
        app.log.debug({ lockKey }, "Sweep omitido: otra instancia tiene el lock de Redis.");
        return;
      }

      await service.purgeExpiredPositions(retentionDays);
    } catch (err) {
      app.log.error({ err }, "Error inesperado durante la purga de posiciones GPS");
    }
  };

  const timer = setInterval(runSweep, intervalMs);

  app.addHook("onClose", async () => {
    clearInterval(timer);
  });
});
