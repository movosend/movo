import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import { registerSweep } from "./register-sweep";
import { createTripRepository } from "../repositories/trip-repository";
import { createNotificationsClient, NotificationsClient } from "../adapters/notifications-client";
import { sendTripDepartureReminders } from "../modules/trips/trip-departure-reminder";
import { createNotificationClaims } from "../utils/notification-claim";

export interface TripDepartureReminderSweepPluginOptions {
  notificationsClient?: NotificationsClient;
  enabled?: boolean;
}

/**
 * MOVO-240: recordatorio al transportista el día anterior a su viaje (desde las 19:00,
 * hora argentina). Mismo esqueleto que el resto de los barridos (`registerSweep`); el
 * aviso se manda una sola vez por viaje gracias al claim en Redis.
 */
export default fp(async (app: FastifyInstance, opts: TripDepartureReminderSweepPluginOptions = {}) => {
  const deps = {
    tripRepository: createTripRepository(app.db),
    notificationsClient: opts.notificationsClient ?? createNotificationsClient(app.config),
    ...createNotificationClaims(app.redis),
    logger: app.log,
  };

  registerSweep(app, {
    name: "Trip departure reminder sweep plugin",
    lockKey: "locks:trip-departure-reminder-sweep",
    enabled: opts.enabled ?? app.config.TRIP_DEPARTURE_REMINDER_SWEEP_ENABLED ?? true,
    intervalMinutes: app.config.TRIP_DEPARTURE_REMINDER_SWEEP_INTERVAL_MINUTES,
    errorMessage: "Error inesperado durante el barrido de recordatorios de viaje",
    run: async () => {
      await sendTripDepartureReminders(deps);
    },
  });
});
