import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import { createTripRepository } from "../repositories/trip-repository";

export interface TripExpirySweepPluginOptions {
  enabled?: boolean;
}

const BATCH_SIZE = 100;

/**
 * MOVO-258 (D5): además de cancelar los `declared` vencidos, pasa a `completed` los `active`
 * cuyos paquetes quedaron todos entregados/cancelados.
 *
 * MOVO-238: cancela periódicamente los viajes `declared` cuyo `departureAt` ya pasó sin
 * que el transportista los iniciara ni tuvieran un paquete aceptado -- mismo esqueleto
 * `setInterval` + lock distribuido en Redis que el resto de los sweeps del servicio
 * (`pickup-expiry-sweep.ts`, `receiver-confirmation-sweep.ts`). Un viaje `active` nunca
 * se toca, y uno vencido CON paquete aceptado queda para revisión manual (ver
 * `TripRepository.cancelOverdueDeclared`).
 *
 * Auditoría (AC5): sin tabla de eventos propia para `Trip` -- alcanza con el log
 * estructurado (`trip_auto_cancelled`) + `updatedAt`, que el `@updatedAt` de Prisma
 * refresca en la cancelación.
 */
export default fp(async (app: FastifyInstance, opts: TripExpirySweepPluginOptions = {}) => {
  const isEnabled = opts.enabled ?? app.config.TRIP_EXPIRY_SWEEP_ENABLED ?? true;
  const intervalMinutes = app.config.TRIP_EXPIRY_SWEEP_INTERVAL_MINUTES;

  if (!isEnabled || intervalMinutes <= 0) {
    app.log.info("Trip expiry sweep plugin está desactivado.");
    return;
  }

  const repository = createTripRepository(app.db);

  const intervalMs = intervalMinutes * 60 * 1000;
  const lockTtlMs = Math.max(10_000, Math.floor(intervalMs * 0.8));
  const lockKey = "locks:trip-expiry-sweep";

  const runSweep = async () => {
    try {
      const acquired = await app.redis.set(lockKey, "locked", "PX", lockTtlMs, "NX");
      if (acquired !== "OK") {
        app.log.debug({ lockKey }, "Sweep omitido: otra instancia tiene el lock de Redis.");
        return;
      }

      const cancelledIds = await repository.cancelOverdueDeclared(new Date(), BATCH_SIZE);
      for (const tripId of cancelledIds) {
        app.log.info(
          { event: "trip_auto_cancelled", tripId, reason: "departure_passed_without_accepted_offers" },
          "Viaje declared vencido cancelado automáticamente",
        );
      }

      // MOVO-258 (D5): cierre automático de viajes `active` cuyos paquetes ya terminaron.
      const completedIds = await repository.completeFinishedActive(BATCH_SIZE);
      for (const tripId of completedIds) {
        app.log.info(
          { event: "trip_auto_completed", tripId, reason: "all_packages_finished" },
          "Viaje active con todos sus paquetes terminados completado automáticamente",
        );
      }

      const emptyActiveIds = await repository.cancelActiveWithoutPackages(BATCH_SIZE);
      for (const tripId of emptyActiveIds) {
        app.log.info(
          { event: "trip_auto_cancelled", tripId, reason: "active_without_packages" },
          "Viaje active sin paquetes vivos cancelado automáticamente",
        );
      }
    } catch (err) {
      app.log.error({ err }, "Error inesperado durante el sweep de viajes declared vencidos");
    }
  };

  const timer = setInterval(runSweep, intervalMs);

  app.addHook("onClose", async () => {
    clearInterval(timer);
  });
});
