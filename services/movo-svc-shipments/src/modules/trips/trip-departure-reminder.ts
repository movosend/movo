import { notificationTriggerCategory, renderNotificationTrigger } from "@movo/shared";
import { TripRepository } from "../../repositories/trip-repository";
import { NotificationsClient } from "../../adapters/notifications-client";
import { departureReminderWindow } from "../../domain/trip-departure-reminder";
import { shortAddress } from "../../utils/short-address";

type ReminderLogger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
};

export interface TripDepartureReminderDeps {
  tripRepository: TripRepository;
  notificationsClient: NotificationsClient;
  /** `SET NX` en Redis (mismo molde que `claimNotificationOnce` de MOVO-258): un solo
   * aviso por viaje aunque el barrido corra muchas veces entre las 19:00 y la medianoche. */
  claimNotificationOnce: (key: string, ttlSeconds: number) => Promise<boolean>;
  releaseNotificationClaim: (key: string) => Promise<void>;
  logger?: ReminderLogger;
}

const BATCH_SIZE = 100;
/** Pasada la salida el claim ya no hace falta; 3 días cubren cualquier reloj desfasado. */
const CLAIM_TTL_SECONDS = 3 * 24 * 60 * 60;

/**
 * MOVO-240: avisa a cada transportista con un viaje `declared` que sale mañana, a partir
 * de las 19:00 (hora argentina). El copy depende de si ya tiene paquetes aceptados. Un
 * push fallido libera el claim para que la próxima vuelta lo reintente. Devuelve cuántos
 * avisos se mandaron.
 */
export async function sendTripDepartureReminders(deps: TripDepartureReminderDeps, now = new Date()): Promise<number> {
  const window = departureReminderWindow(now);
  if (!window) return 0;

  const trips = await deps.tripRepository.findDeclaredForDepartureReminder({ ...window, limit: BATCH_SIZE });
  let sent = 0;
  for (const trip of trips) {
    const claimKey = `trip-departure-reminder:${trip.id}`;
    if (!(await deps.claimNotificationOnce(claimKey, CLAIM_TTL_SECONDS))) continue;

    const { title, body } = renderNotificationTrigger("tripDepartureReminder", {
      destinationShort: shortAddress(trip.destinationAddress),
      packagesCount: trip.acceptedPackagesCount,
    });
    try {
      await deps.notificationsClient.sendPush({
        userId: trip.carrierId,
        title,
        body,
        category: notificationTriggerCategory("tripDepartureReminder"),
        data: { type: "trip_reminder", tripId: trip.id },
      });
      sent++;
    } catch (err) {
      await deps.releaseNotificationClaim(claimKey);
      deps.logger?.warn(
        { err, event: "notification_dispatch_failed", tripId: trip.id, carrierId: trip.carrierId },
        "No se pudo mandar el recordatorio del viaje de mañana"
      );
    }
  }
  if (sent > 0) {
    deps.logger?.info({ event: "trip_departure_reminders_sent", count: sent }, "Recordatorios de viaje enviados");
  }
  return sent;
}
