import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import { registerSweep } from "./register-sweep";
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
 * (`pickup-expiry-sweep.ts`, `receiver-confirmation-sweep.ts`). Un `declared` vencido CON
 * paquete aceptado queda sin tocar hasta que el envío se retire o se cancele (ver
 * `TripRepository.cancelOverdueDeclared`). Desde MOVO-258 un `active` solo se toca para
 * cerrarlo cuando sus paquetes terminaron (`completed`) o ya no le queda ninguno (`expired`).
 *
 * Auditoría (AC5): sin tabla de eventos propia para `Trip` -- alcanza con el log
 * estructurado (`trip_auto_expired`) + `updatedAt`, que el `@updatedAt` de Prisma
 * refresca en la cancelación.
 */
export default fp(async (app: FastifyInstance, opts: TripExpirySweepPluginOptions = {}) => {
  const repository = createTripRepository(app.db);

  // Un paso que falla no debe frenar a los demás: con un solo try/catch, una fila mala en
  // `cancelOverdueDeclared` dejaba sin correr (para siempre) el cierre de los `active`
  // terminados o vacíos, y con el índice de 1 viaje activo el transportista quedaba bloqueado.
  const runStep = async (step: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      app.log.error({ err, step }, "Error en un paso del sweep de viajes");
    }
  };

  registerSweep(app, {
    name: "Trip expiry sweep plugin",
    lockKey: "locks:trip-expiry-sweep",
    enabled: opts.enabled ?? app.config.TRIP_EXPIRY_SWEEP_ENABLED ?? true,
    intervalMinutes: app.config.TRIP_EXPIRY_SWEEP_INTERVAL_MINUTES,
    errorMessage: "Error inesperado durante el sweep de viajes",
    run: async () => {
      await runStep("cancel_overdue_declared", async () => {
        const expiredIds = await repository.cancelOverdueDeclared(new Date(), BATCH_SIZE);
        for (const tripId of expiredIds) {
          app.log.info(
            { event: "trip_auto_expired", tripId, reason: "departure_passed_without_accepted_offers" },
            "Viaje declared vencido expirado automáticamente",
          );
        }
      });

      // MOVO-258 (D5): cierre automático de viajes `active` cuyos paquetes ya terminaron.
      await runStep("complete_finished_active", async () => {
        const completedIds = await repository.completeFinishedActive(BATCH_SIZE);
        for (const tripId of completedIds) {
          app.log.info(
            { event: "trip_auto_completed", tripId, reason: "all_packages_finished" },
            "Viaje active con todos sus paquetes terminados completado automáticamente",
          );
        }
      });

      await runStep("expire_active_without_packages", async () => {
        const emptyActiveIds = await repository.expireActiveWithoutPackages(BATCH_SIZE);
        for (const tripId of emptyActiveIds) {
          app.log.info(
            { event: "trip_auto_expired", tripId, reason: "active_without_packages" },
            "Viaje active sin paquetes vivos expirado automáticamente",
          );
        }
      });
    },
  });
});
