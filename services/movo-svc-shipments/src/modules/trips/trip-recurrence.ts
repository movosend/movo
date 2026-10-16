import {
  AccountStatus,
  NotificationTriggerKey,
  formatArgentinaShortDay,
  nextRecurrenceOccurrence,
  notificationTriggerCategory,
  renderNotificationTrigger,
} from "@movo/shared";
import { TripRepository } from "../../repositories/trip-repository";
import { ShipmentRepository } from "../../repositories/shipment-repository";
import { UsersClient } from "../../adapters/users-client";
import { PaymentsClient } from "../../adapters/payments-client";
import { NotificationsClient } from "../../adapters/notifications-client";
import { CarrierEligibility, resolveCarrierEligibility } from "../../utils/carrier-gate";
import { PHANTOM_SERIES_STREAK, isPhantomSeries } from "../../domain/trip-recurrence";
import { shortAddress } from "../../utils/short-address";
import { NotificationClaims } from "../../utils/notification-claim";
import { Trip } from "../../models/trip";

/** Un aviso por ocurrencia frenada por deuda; el vigente cambia al declararse la siguiente. */
const DEBT_BLOCK_CLAIM_TTL_SECONDS = 30 * 24 * 60 * 60;

type RecurrenceLogger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
};

export interface TripRecurrenceDeps {
  tripRepository: TripRepository;
  usersClient: UsersClient;
  paymentsClient: PaymentsClient;
  /** MOVO-278 (ADR-045): un transportista con una disputa abierta corta la serie, como el
   * resto de los requisitos de ADR-036. */
  shipmentRepository: Pick<ShipmentRepository, "hasOpenDisputeAsCarrier">;
  notificationsClient?: NotificationsClient;
  /** MOVO-313: dedupe del aviso "frenado por deuda" (corre cada pasada del barrido). Sin él no
   * se avisa, para no repetir la push en cada corrida. */
  claims?: NotificationClaims;
  logger?: RecurrenceLogger;
}

export interface TripRecurrenceRunResult {
  generated: number;
  stopped: number;
  deferred: number;
  /** Otra corrida (u otra réplica) ya había generado la ocurrencia: no es un error ni se posterga. */
  alreadyGenerated: number;
}

type SeriesOutcome = "generated" | "stopped" | "deferred" | "alreadyGenerated";

/** Por qué se apagó una serie sola. `until_reached` es el fin natural (sin push). */
export type RecurrenceStopReason = "phantom" | "account_unavailable" | "requirements_missing" | "until_reached";

const BATCH_SIZE = 100;
/** Tope de páginas por corrida, mismo criterio que el recordatorio del día anterior. */
const MAX_PAGES = 20;

/**
 * MOVO-265 (ADR-042): continúa las series recurrentes. Para cada trip vigente con la
 * recurrencia prendida cuyo `departureAt` ya pasó (en cualquier estado), en orden:
 *
 * 1. Serie fantasma (las últimas 3 ocurrencias `expired`): apaga la recurrencia y avisa.
 * 2. Fecha siguiente (`nextRecurrenceOccurrence`). Si ya no entra en `recurrenceUntil`, la
 *    serie termina sola: se apaga sin push, si no seguiría contando para el tope de 3 y se
 *    reevaluaría en cada corrida.
 * 3. Elegibilidad: generar es declarar en nombre del transportista, así que se le exige lo
 *    mismo que a `POST /trips` (ADR-036) y que su cuenta no esté suspendida. Si `svc-users`
 *    o `svc-payments` no responden, no se corta: se reintenta en la próxima corrida (la
 *    fecha sale de `max(departureAt, now)`, así que no nace vencida).
 * 4. Insert idempotente (`ON CONFLICT DO NOTHING` sobre `generatedFromTripId`) y push.
 *
 * Auditoría como MOVO-238: log estructurado por generación y por corte, sin tabla propia, y
 * un resumen por corrida (`trip_recurrence_run`) cuando hubo algún candidato.
 */
export async function generateRecurringOccurrences(
  deps: TripRecurrenceDeps,
  now = new Date(),
): Promise<TripRecurrenceRunResult> {
  const result: TripRecurrenceRunResult = { generated: 0, stopped: 0, deferred: 0, alreadyGenerated: 0 };
  let after: { departureAt: Date; id: string } | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const candidates = await deps.tripRepository.findRecurrenceCandidates({ now, limit: BATCH_SIZE, after });
    for (const trip of candidates) {
      try {
        const outcome = await continueSeries(deps, trip, now);
        result[outcome]++;
      } catch (err) {
        // Una fila mala no frena al resto del lote; se reintenta en la próxima corrida.
        result.deferred++;
        deps.logger?.warn(
          { err, event: "trip_recurrence_generation_failed", tripId: trip.id },
          "Error al continuar una serie de viajes recurrentes",
        );
      }
    }
    if (candidates.length < BATCH_SIZE) break;
    const last = candidates[candidates.length - 1];
    after = { departureAt: last.departureAt, id: last.id };
  }
  if (result.generated + result.stopped + result.deferred + result.alreadyGenerated > 0) {
    // `deferred` alto en varias corridas seguidas suele ser `svc-users`/`svc-payments` caídos o
    // sin `accountStatus`: las series no avanzan hasta que vuelvan.
    deps.logger?.info({ event: "trip_recurrence_run", ...result }, "Barrido de viajes recurrentes terminado");
  }
  return result;
}

async function continueSeries(
  deps: TripRecurrenceDeps,
  trip: Trip,
  now: Date,
): Promise<SeriesOutcome> {
  const weekdays = trip.recurrenceWeekdays;
  if (weekdays === null) return "deferred";

  const recentStatuses = await deps.tripRepository.listRecentSeriesStatuses(trip.seriesId ?? trip.id, PHANTOM_SERIES_STREAK);
  if (isPhantomSeries(recentStatuses)) {
    return (await stopSeries(deps, trip, "phantom")) ? "stopped" : "deferred";
  }

  const departureAt = nextRecurrenceOccurrence({
    departureAt: trip.departureAt,
    weekdays,
    until: trip.recurrenceUntil,
    now,
  });
  if (departureAt === null) {
    return (await stopSeries(deps, trip, "until_reached")) ? "stopped" : "deferred";
  }

  let eligibility: CarrierEligibility;
  try {
    eligibility = await resolveCarrierEligibility(deps, trip.carrierId);
  } catch (err) {
    deps.logger?.warn(
      { err, event: "trip_recurrence_generation_deferred", tripId: trip.id, carrierId: trip.carrierId },
      "No se pudo verificar al transportista: la ocurrencia siguiente se reintenta en la próxima corrida",
    );
    return "deferred";
  }
  if (eligibility.account === undefined) {
    deps.logger?.warn(
      { event: "trip_recurrence_generation_deferred", tripId: trip.id, carrierId: trip.carrierId },
      "svc-users no informó el estado de la cuenta: la ocurrencia siguiente se reintenta en la próxima corrida",
    );
    return "deferred";
  }
  // MOVO-313: la deuda vencida frena SOLO la ocurrencia que sigue. La serie queda intacta (no se
  // apaga ni se avisa del corte): en cada corrida se vuelve a mirar y, apenas se salda la deuda,
  // se declara la siguiente como si nada. `nextRecurrenceOccurrence` sale de `max(departureAt, now)`,
  // así que no nace vencida ni se acumulan ocurrencias atrasadas.
  if (isOnlyOverdueDebt(eligibility, now)) {
    deps.logger?.info(
      { event: "trip_recurrence_generation_blocked_by_debt", tripId: trip.id, carrierId: trip.carrierId },
      "Deuda vencida: la ocurrencia siguiente se declara cuando el transportista la salde",
    );
    await notifyBlockedByDebt(deps, trip);
    return "deferred";
  }
  const unavailableReason = ineligibilityReason(eligibility, now);
  if (unavailableReason) {
    return (await stopSeries(deps, trip, unavailableReason)) ? "stopped" : "deferred";
  }

  const next = await deps.tripRepository.createRecurrenceSuccessor({
    carrierId: trip.carrierId,
    originAddress: trip.originAddress,
    originLat: trip.originLat,
    originLng: trip.originLng,
    destinationAddress: trip.destinationAddress,
    destinationLat: trip.destinationLat,
    destinationLng: trip.destinationLng,
    departureAt,
    vehicleType: trip.vehicleType,
    recurrenceWeekdays: weekdays,
    recurrenceUntil: trip.recurrenceUntil,
    seriesId: trip.seriesId ?? trip.id,
    generatedFromTripId: trip.id,
  });
  // Otra corrida (u otra réplica) ya la generó: no se avisa dos veces.
  if (next === null) return "alreadyGenerated";

  deps.logger?.info(
    {
      event: "trip_recurrence_generated",
      tripId: next.id,
      generatedFromTripId: trip.id,
      seriesId: next.seriesId,
      carrierId: trip.carrierId,
      departureAt: next.departureAt.toISOString(),
    },
    "Ocurrencia siguiente de un viaje recurrente declarada",
  );
  await notify(deps, trip.carrierId, "tripRecurrenceGenerated", {
    params: { dayLabel: formatArgentinaShortDay(next.departureAt), destinationShort: shortAddress(next.destinationAddress) },
    data: { type: "trip_recurrence_generated", tripId: next.id },
  });
  return "generated";
}

/** La cuenta está bien y la identidad también: lo único que falta es saldar una deuda vencida. */
function isOnlyOverdueDebt(eligibility: CarrierEligibility, now: Date): boolean {
  const account = eligibility.account ?? null;
  const accountOk =
    account !== null &&
    account.status === AccountStatus.ACTIVE &&
    (account.bannedUntil === null || account.bannedUntil <= now);
  return (
    accountOk &&
    eligibility.identityApproved &&
    eligibility.missingRequirements.length === 1 &&
    eligibility.missingRequirements[0] === "no_overdue_debt"
  );
}

/** `null` si el transportista puede seguir declarando; si no, el motivo del corte. */
function ineligibilityReason(eligibility: CarrierEligibility, now: Date): RecurrenceStopReason | null {
  const account = eligibility.account ?? null;
  if (
    account === null ||
    account.status !== AccountStatus.ACTIVE ||
    (account.bannedUntil !== null && account.bannedUntil > now)
  ) {
    return "account_unavailable";
  }
  if (!eligibility.identityApproved || eligibility.missingRequirements.length > 0) {
    return "requirements_missing";
  }
  return null;
}

/** Apaga la recurrencia (compare-and-swap) y avisa. `false` si otro proceso ya la cambió. */
async function stopSeries(deps: TripRecurrenceDeps, trip: Trip, reason: RecurrenceStopReason): Promise<boolean> {
  if (!(await deps.tripRepository.stopRecurrence(trip.id))) return false;

  deps.logger?.info(
    { event: "trip_recurrence_stopped", tripId: trip.id, seriesId: trip.seriesId, carrierId: trip.carrierId, reason },
    "Serie de viajes recurrentes cortada automáticamente",
  );
  if (reason === "until_reached") return true;

  const triggerKey = reason === "phantom" ? "tripRecurrenceStoppedPhantom" : "tripRecurrenceStoppedUnavailable";
  await notify(deps, trip.carrierId, triggerKey, {
    params: { destinationShort: shortAddress(trip.destinationAddress) },
    data: { type: "trip_recurrence_stopped", tripId: trip.id },
  });
  return true;
}

/**
 * MOVO-313: avisa una sola vez por ocurrencia frenada (clave = el viaje vigente, que cambia
 * recién cuando se declara la siguiente). Si el push falla se suelta el claim y la próxima
 * pasada lo reintenta. Sin `claims` no avisa: sin dedupe saldría en cada corrida.
 */
async function notifyBlockedByDebt(deps: TripRecurrenceDeps, trip: Trip): Promise<void> {
  if (!deps.claims || !deps.notificationsClient) return;
  const claimKey = `trip-recurrence-debt:${trip.id}`;
  if (!(await deps.claims.claimNotificationOnce(claimKey, DEBT_BLOCK_CLAIM_TTL_SECONDS))) return;
  const sent = await notify(deps, trip.carrierId, "tripRecurrenceBlockedByDebt", {
    params: { destinationShort: shortAddress(trip.destinationAddress) },
    data: { type: "trip_recurrence_blocked", tripId: trip.id },
  });
  if (!sent) await deps.claims.releaseNotificationClaim(claimKey);
}

/** Best-effort, como el resto de los avisos de los barridos: un push que falla solo se loguea.
 * Devuelve si salió, para quien necesite soltar un claim. */
async function notify<K extends NotificationTriggerKey>(
  deps: TripRecurrenceDeps,
  carrierId: string,
  triggerKey: K,
  payload: { params: Parameters<typeof renderNotificationTrigger<K>>[1]; data: Record<string, unknown> },
): Promise<boolean> {
  if (!deps.notificationsClient) return false;
  const { title, body } = renderNotificationTrigger(triggerKey, payload.params);
  try {
    await deps.notificationsClient.sendPush({
      userId: carrierId,
      title,
      body,
      category: notificationTriggerCategory(triggerKey),
      data: payload.data,
    });
    return true;
  } catch (err) {
    deps.logger?.warn(
      { err, event: "notification_dispatch_failed", carrierId, triggerKey, ...payload.data },
      "No se pudo avisar al transportista sobre su viaje recurrente",
    );
    return false;
  }
}
