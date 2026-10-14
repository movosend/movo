import { notificationTriggerCategory, renderNotificationTrigger } from "@movo/shared";
import { DepartureReminderTrip, TripRepository } from "../../repositories/trip-repository";
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
/** Tope de páginas por corrida (2.000 viajes): si se alcanza, la próxima vuelta sigue desde el
 * principio y los ya avisados se saltean por el claim. */
const MAX_PAGES = 20;
/** Pasada la salida el claim ya no hace falta; 3 días cubren cualquier reloj desfasado. */
const CLAIM_TTL_SECONDS = 3 * 24 * 60 * 60;

/**
 * MOVO-240: avisa a cada transportista con un viaje `declared` que sale mañana, a partir
 * de las 19:00 (hora argentina). El copy depende de si ya tiene paquetes aceptados. Recorre
 * todas las páginas de la ventana (cursor por `departureAt, id`): con solo la primera, más de
 * 100 viajes ya avisados tapaban al resto en cada vuelta. Devuelve cuántos avisos se mandaron.
 *
 * Entrega como mucho una vez (at-most-once): el claim se toma antes del push y solo se libera
 * si `sendPush` falla. Si el proceso muere entre los dos, ese viaje se queda sin recordatorio
 * (el claim vive hasta que pasa la salida). Se aceptó: es un aviso de cortesía, y la
 * alternativa (claim después del push) repetiría el aviso ante cualquier carrera entre réplicas.
 */
export async function sendTripDepartureReminders(deps: TripDepartureReminderDeps, now = new Date()): Promise<number> {
  const window = departureReminderWindow(now);
  if (!window) return 0;

  let sent = 0;
  let afterId: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const trips = await deps.tripRepository.findDeclaredForDepartureReminder({ ...window, limit: BATCH_SIZE, afterId });
    for (const trip of trips) {
      if (await remindTrip(deps, trip)) sent++;
    }
    if (trips.length < BATCH_SIZE) break;
    afterId = trips[trips.length - 1].id;
  }
  if (sent > 0) {
    deps.logger?.info({ event: "trip_departure_reminders_sent", count: sent }, "Recordatorios de viaje enviados");
  }
  return sent;
}

/** Un recordatorio: `true` si el push salió. Un push fallido libera el claim para reintentar. */
async function remindTrip(deps: TripDepartureReminderDeps, trip: DepartureReminderTrip): Promise<boolean> {
  const claimKey = `trip-departure-reminder:${trip.id}`;
  if (!(await deps.claimNotificationOnce(claimKey, CLAIM_TTL_SECONDS))) return false;

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
    return true;
  } catch (err) {
    await deps.releaseNotificationClaim(claimKey);
    deps.logger?.warn(
      { err, event: "notification_dispatch_failed", tripId: trip.id, carrierId: trip.carrierId },
      "No se pudo mandar el recordatorio del viaje de mañana"
    );
    return false;
  }
}
