import type { FastifyBaseLogger } from "fastify";
import type { HoldProviderEventKind } from "@movo/shared";
import { MercadoPagoClient, PaymentResponse } from "../../adapters/mercadopago-client";
import { AlertNotifier } from "../../adapters/alert-notifier";
import { ShipmentNotFoundError, ShipmentsClient } from "../../adapters/shipments-client";
import { CarrierMpAccountRepository, CarrierMpCredentials } from "../../repositories/carrier-mp-account-repository";
import { Hold, HoldRepository } from "../../repositories/hold-repository";
import {
  MpWebhookNotification,
  MpWebhookRepository,
  NotificationResolution,
} from "../../repositories/mp-webhook-repository";
import { missingCardFields } from "../../utils/payment-card";
import type { BalancePaymentService } from "../balance-payment/balance-payment.service";
import { holdUpdateFromPayment, HoldService, readMpError } from "../holds/hold.service";

/**
 * Cuánto se "reserva" una notificación al tomarla. Si el proceso muere a mitad de camino
 * el barrido la retoma pasado este plazo; alcanza para un `Payment.get` (peor caso ~22s,
 * ver `MERCADOPAGO_TIMEOUT_MS`) más el aviso a svc-shipments.
 */
export const CLAIM_LEASE_MS = 2 * 60 * 1000;

/** Tope del backoff entre reintentos. */
const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000;

/** Backoff exponencial: 1, 2, 4, 8... minutos según los intentos ya hechos, hasta 6 h. */
export function retryDelayMs(attempts: number): number {
  return Math.min(MAX_BACKOFF_MS, 60_000 * 2 ** Math.max(0, attempts - 1));
}

/** Estados del hold que todavía pueden cambiar por algo que haga MP. */
const MUTABLE_HOLD_STATUSES = new Set<Hold["status"]>(["creating", "in_process", "authorized"]);

/** Estados de MP sobre un pago que Movo no inició: se registran y se avisa al equipo (AC5). */
const PROVIDER_EVENT_KINDS = {
  charged_back: "chargeback",
  refunded: "refund",
  in_mediation: "mediation",
} as const;

/** El aviso a svc-shipments que corresponde a un hold que quedó en `status` (o `null` si no hay que avisar). */
function holdEventFor(status: Hold["status"] | undefined, statusDetail: string | null): HoldProviderEventKind | null {
  if (status === "cancelled") return statusDetail === "expired" ? "expired" : "cancelled";
  if (status === "rejected") return "rejected";
  return null;
}

/** Un fallo que puede resolverse solo: la notificación vuelve a `pending` con backoff. */
class TransientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransientError";
  }
}

/** Datos ya validados de una notificación entrante (la firma la chequeó la ruta). */
export interface IncomingMpNotification {
  mpNotificationId: string;
  topic: string;
  action: string | null;
  mpPaymentId: string;
  mpUserId: string | null;
  liveMode: boolean | null;
}

export interface MpWebhookServiceDeps {
  repo: MpWebhookRepository;
  holds: HoldRepository;
  /** Para resolver un intento en `creating` cuyo pago llega por el webhook. */
  holdService: Pick<HoldService, "getByShipment">;
  accounts: CarrierMpAccountRepository;
  mercadoPago: MercadoPagoClient;
  shipments: ShipmentsClient;
  alerts: AlertNotifier;
  log: FastifyBaseLogger;
  holdValidityDays: number;
  /** Intentos antes de dar la notificación por `failed` y alertar. */
  maxAttempts: number;
  /**
   * MOVO-312: "Pagar mi saldo". Estos pagos tienen de cobrador a la cuenta de Movo (no a un transportista) y no
   * están en `holds`. Es un getter porque el service se arma después que este (usa `app.alerts`).
   */
  balancePayments?: () => Pick<BalancePaymentService, "applyPayment" | "collectorForWebhook"> | undefined;
  now?: () => Date;
}

type Resolution = NotificationResolution;

const done = (status: "processed" | "ignored" | "unverifiable" | "failed", outcome: string): Resolution => ({
  status,
  outcome,
});

/**
 * MOVO-268: procesa las notificaciones del webhook de Mercado Pago (tópico `payment`).
 *
 * - **Nunca confía en el body (AC3)**: de la notificación solo se usa el id del pago (y
 *   el `user_id` del vendedor para encontrar sus credenciales); el estado sale siempre
 *   de `Payment.get` con el access_token del transportista dueño del pago.
 * - **Idempotente (AC6)**: el inbox descarta el reenvío de la misma notificación; el
 *   cambio de estado del hold es un UPDATE condicional (`transitionHold`), así dos
 *   notificaciones del mismo cambio producen una sola transición y un solo aviso; y los
 *   contracargos se registran una vez por (pago, estado) con una sola alerta.
 * - **Sin reintentos infinitos (AC7)**: la ruta responde 200 apenas guarda la
 *   notificación. Un error propio deja la notificación `pending` con backoff, y al
 *   llegar a `maxAttempts` pasa a `failed` con una alerta al equipo.
 *
 * El dueño de `authorized → captured` es la captura (MOVO-212): un pago `approved` que
 * llega por acá no toca el hold, para no adelantarse a la liquidación que persiste ese
 * ticket.
 */
export function createMpWebhookService(deps: MpWebhookServiceDeps) {
  const { repo, holds, accounts, mercadoPago, shipments, alerts, log } = deps;
  const now = deps.now ?? (() => new Date());
  const inFlight = new Set<Promise<void>>();

  /** `Payment.get` clasificando el error: qué se reintenta y qué no. */
  async function fetchPayment(
    accessToken: string,
    mpPaymentId: string
  ): Promise<{ kind: "ok"; payment: PaymentResponse } | { kind: "auth" } | { kind: "not_found" }> {
    try {
      return { kind: "ok", payment: await mercadoPago.getPayment(accessToken, mpPaymentId) };
    } catch (error) {
      const info = readMpError(error);
      if (info.status === 401 || info.status === 403) return { kind: "auth" };
      if (info.status === 404) return { kind: "not_found" };
      throw new TransientError(`Payment.get falló (${info.status ?? "sin status"}): ${info.message}`);
    }
  }

  async function deliverHoldEvent(
    notification: MpWebhookNotification,
    hold: Hold,
    event: HoldProviderEventKind,
    statusDetail: string | null
  ): Promise<Resolution> {
    let result;
    try {
      result = await shipments.notifyHoldEvent(hold.shipmentId, { holdId: hold.id, event, statusDetail });
    } catch (error) {
      if (error instanceof ShipmentNotFoundError) {
        log.warn(
          { notificationId: notification.id, holdId: hold.id, shipmentId: hold.shipmentId },
          "svc-shipments no conoce el envío del hold: el aviso se descarta"
        );
        await repo.clearPendingHoldEvent(notification.id);
        return done("processed", `hold_${event}_shipment_not_found`);
      }
      // svc-shipments caído: `pendingHoldEvent` queda escrito y el reintento vuelve a avisar.
      throw new TransientError(error instanceof Error ? error.message : String(error));
    }
    await repo.clearPendingHoldEvent(notification.id);
    log.info(
      { notificationId: notification.id, holdId: hold.id, shipmentId: hold.shipmentId, event, ...result },
      "svc-shipments avisado del cambio del hold"
    );
    if (result.outcome === "hold_lost_after_pickup") {
      // El paquete ya está en camino o entregado y la reserva se perdió: la captura de
      // MOVO-212 va a fallar. svc-shipments no tiene a qué estado volver; alguien tiene
      // que mirarlo (MOVO-213 lo escalaría al intentar capturar, esto avisa antes).
      await alerts.send({
        kind: "mp_hold_lost_after_pickup",
        message: "MP canceló o venció el hold de un envío ya retirado: el cobro al entregar va a fallar",
        context: { shipmentId: hold.shipmentId, holdId: hold.id, mpPaymentId: hold.mpPaymentId, event },
      });
    }
    return done("processed", `hold_${event}_notified:${result.outcome}`);
  }

  async function recordProviderEvent(
    hold: Hold,
    payment: PaymentResponse,
    kind: (typeof PROVIDER_EVENT_KINDS)[keyof typeof PROVIDER_EVENT_KINDS]
  ): Promise<Resolution> {
    const mpStatus = payment.status ?? "unknown";
    const refunded = payment.transaction_amount_refunded;
    const event = await repo.recordProviderEvent({
      holdId: hold.id,
      shipmentId: hold.shipmentId,
      mpPaymentId: String(payment.id),
      kind,
      mpStatus,
      mpStatusDetail: payment.status_detail ?? null,
      amountArs: typeof refunded === "number" && refunded > 0 ? refunded : null,
      holdStatus: hold.status,
    });
    if (!event) return done("processed", `${kind}_already_recorded`);

    await alerts.send({
      kind: `mp_${kind}`,
      message:
        kind === "chargeback"
          ? "Contracargo de Mercado Pago sobre un pago de Movo"
          : kind === "refund"
            ? "Reembolso hecho por fuera de Movo sobre un pago de Movo"
            : "El pagador abrió una mediación en Mercado Pago",
      context: {
        shipmentId: hold.shipmentId,
        holdId: hold.id,
        mpPaymentId: String(payment.id),
        holdStatus: hold.status,
        mpStatus,
        mpStatusDetail: payment.status_detail ?? null,
        amountArs: hold.amountArs.toNumber(),
        refundedArs: event.amountArs?.toNumber() ?? null,
      },
    });
    await repo.markProviderEventAlerted(event.id, now());
    return done("processed", `${kind}_recorded`);
  }

  /**
   * MOVO-302: completa marca y últimos 4 de la tarjeta si el hold no los tenía y este pago los trae.
   * Va ANTES de cualquier decisión sobre el estado y es independiente de ella: un `no_change`, un
   * contracargo o un reembolso cortan el procesamiento sin pasar por `transitionHold`, y de otro
   * modo la tarjeta que el webhook ya tenía en la mano se perdería. Solo agrega lo que falta.
   */
  async function fillMissingCard(hold: Hold, payment: PaymentResponse): Promise<Hold> {
    const missing = missingCardFields(hold, payment);
    return Object.keys(missing).length > 0 ? holds.update(hold.id, missing) : hold;
  }

  async function applyPayment(
    notification: MpWebhookNotification,
    current: Hold,
    payment: PaymentResponse
  ): Promise<Resolution> {
    const hold = await fillMissingCard(current, payment);
    const status = payment.status ?? "";
    // `hasOwn` y no `in`: un `status` como "constructor" o "toString" no puede colarse por la cadena de prototipos.
    if (Object.prototype.hasOwnProperty.call(PROVIDER_EVENT_KINDS, status)) {
      return recordProviderEvent(hold, payment, PROVIDER_EVENT_KINDS[status as keyof typeof PROVIDER_EVENT_KINDS]);
    }

    if (status === "approved") {
      // Captura: la dueña de esa transición es MOVO-212, que persiste la liquidación.
      if (hold.status !== "captured") {
        log.warn(
          { notificationId: notification.id, holdId: hold.id, holdStatus: hold.status, mpPaymentId: hold.mpPaymentId },
          "MP informa el pago como approved y el hold no figura capturado: lo resuelve la captura (MOVO-212)"
        );
      }
      return done("processed", "approved_left_to_capture");
    }

    if (!MUTABLE_HOLD_STATUSES.has(hold.status)) return done("processed", `hold_already_${hold.status}`);

    const patch = holdUpdateFromPayment(payment, hold, now(), deps.holdValidityDays);
    if (!patch) {
      log.error(
        { notificationId: notification.id, holdId: hold.id, mpStatus: status, mpStatusDetail: payment.status_detail },
        "estado de pago de MP desconocido en el webhook, el hold queda sin cambios"
      );
      return done("processed", `unknown_mp_status:${status || "empty"}`);
    }
    if (patch.status === hold.status) return done("processed", "no_change");

    const statusDetail = patch.statusDetail ?? null;
    // MP no tiene un estado "vencido": un hold que no se capturó a tiempo llega como
    // `cancelled` con `status_detail: expired` (supuesto: el sandbox no vence holds, ADR-050).
    const event = holdEventFor(patch.status, statusDetail);

    const transitioned = await repo.transitionHold({
      notificationId: notification.id,
      holdId: hold.id,
      expectedStatus: hold.status,
      patch,
      pendingEvent: event,
      pendingEventDetail: event ? statusDetail : null,
    });
    if (!transitioned) return done("processed", "hold_changed_concurrently");

    log.info(
      { notificationId: notification.id, holdId: hold.id, from: hold.status, to: patch.status, statusDetail },
      "hold actualizado por el webhook de MP"
    );
    if (!event) return done("processed", `hold_${patch.status}`);
    return deliverHoldEvent(notification, { ...hold, status: patch.status! }, event, statusDetail);
  }

  /**
   * El pago no está asociado a ningún hold: puede ser de otro integrador del vendedor, o
   * el de un intento que quedó en `creating` (MP no respondió al crear). Para el segundo
   * caso se busca el envío por `external_reference` y se reconcilia el intento.
   */
  async function resolveUnknownPayment(
    notification: MpWebhookNotification
  ): Promise<
    { hold: Hold; credentials: CarrierMpCredentials; payment: PaymentResponse; reconciledFrom: Hold["status"] | null } | Resolution
  > {
    if (!notification.mpUserId) return done("ignored", "unknown_payment");
    const credentials = await accounts.findCredentialsByMpUserId(notification.mpUserId);
    if (!credentials) return done("ignored", "unknown_payment");

    const fetched = await fetchPayment(credentials.accessToken, notification.mpPaymentId);
    if (fetched.kind !== "ok") return done("ignored", `unknown_payment_${fetched.kind}`);
    // El `user_id` del body no está firmado: solo orienta qué credenciales probar. El pago tiene que
    // ser realmente de ese vendedor, o se ignora (defensa en profundidad ante un body forjado).
    const collectorId = (fetched.payment as { collector_id?: number | string }).collector_id;
    if (collectorId !== undefined && String(collectorId) !== credentials.mpUserId) {
      return done("ignored", "unknown_payment_collector_mismatch");
    }
    const shipmentId = fetched.payment.external_reference;
    if (!shipmentId) return done("ignored", "unknown_payment");

    const latest = await holds.findLatestByShipment(shipmentId).catch(() => null);
    let reconciledFrom: Hold["status"] | null = null;
    if (latest?.status === "creating" && latest.carrierId === credentials.userId) {
      reconciledFrom = latest.status;
      try {
        await deps.holdService.getByShipment(shipmentId, { sync: true });
      } catch (error) {
        throw new TransientError(`no se pudo reconciliar el intento en creating: ${String(error)}`);
      }
    }
    const hold = await holds.findByMpPaymentId(notification.mpPaymentId);
    if (!hold) return done("ignored", "unknown_payment");
    return { hold, credentials, payment: fetched.payment, reconciledFrom };
  }

  /**
   * MOVO-312 (AC5): ¿el pago es de un intento de "Pagar mi saldo"? Se consulta con el token de MOVO (solo ve los
   * pagos donde Movo es cobrador, así que un pago ajeno da 401/403/404 y se descarta) y se asocia por el
   * `external_reference` (el id del intento). `null` si no lo es: el webhook sigue con el camino de los holds.
   */
  async function resolveBalancePayment(notification: MpWebhookNotification): Promise<Resolution | null> {
    const balance = deps.balancePayments?.();
    if (!balance) return null;
    // Solo los pagos de la cuenta cobradora de Movo (un pago de un transportista vinculado es de holds): sin cuenta
    // cobradora configurada o con otro `user_id`, esto no es un pago de saldo.
    let collector: Awaited<ReturnType<typeof balance.collectorForWebhook>>;
    try {
      collector = await balance.collectorForWebhook(notification.mpUserId ?? undefined);
    } catch (error) {
      throw new TransientError(error instanceof Error ? error.message : String(error));
    }
    if (!collector) return null;
    const fetched = await fetchPayment(collector.accessToken, notification.mpPaymentId);
    if (fetched.kind !== "ok") return null;
    if (String(fetched.payment.id) !== notification.mpPaymentId) return null;

    const outcome = await balance.applyPayment(fetched.payment);
    return outcome ? done("processed", `balance_payment_${outcome}`) : null;
  }

  async function handle(notification: MpWebhookNotification): Promise<Resolution> {
    // Un intento anterior ya cambió el hold pero no pudo avisar a svc-shipments.
    if (notification.pendingHoldEvent && notification.holdId) {
      const hold = await holds.findById(notification.holdId);
      if (!hold) return done("failed", "pending_event_hold_missing");
      return deliverHoldEvent(notification, hold, notification.pendingHoldEvent, notification.pendingHoldEventDetail);
    }

    const known = await holds.findByMpPaymentId(notification.mpPaymentId);
    if (!known) {
      const balance = await resolveBalancePayment(notification);
      if (balance) return balance;
      const resolved = await resolveUnknownPayment(notification);
      if ("status" in resolved) return resolved;
      // La reconciliación (`?sync=true`) adoptó el intento con lo que devuelve la búsqueda de pagos; el
      // pago completo que ya tenemos en la mano completa la tarjeta si la búsqueda no la trajo (MOVO-302).
      // Va antes del aviso de abajo, que corta el procesamiento sin pasar por `applyPayment`.
      const reconciled = await fillMissingCard(resolved.hold, resolved.payment);
      // La reconciliación (`?sync=true`) ya escribió el estado final de MP en el hold. Si lo llevó a
      // cancelado/vencido/rechazado, `applyPayment` lo vería "ya cerrado" y no avisaría nunca: el envío no
      // se enteraría de que la reserva se cayó. Se avisa acá, dejando anotado el aviso por si hay que reintentar.
      if (resolved.reconciledFrom && reconciled.status !== resolved.reconciledFrom) {
        const detail = reconciled.statusDetail ?? null;
        const event = holdEventFor(reconciled.status, detail);
        if (event) {
          await repo.setPendingHoldEvent(notification.id, reconciled.id, event, detail);
          return deliverHoldEvent(notification, reconciled, event, detail);
        }
      }
      return applyPayment(notification, reconciled, resolved.payment);
    }

    // Credenciales del transportista del hold, no las del `user_id` del body (AC3).
    const credentials = await accounts.findCredentials(known.carrierId);
    if (!credentials) return done("unverifiable", "carrier_credentials_missing");

    const fetched = await fetchPayment(credentials.accessToken, notification.mpPaymentId);
    if (fetched.kind === "auth") return done("unverifiable", "carrier_token_rejected");
    if (fetched.kind === "not_found") return done("failed", "payment_not_found");
    if (String(fetched.payment.id) !== notification.mpPaymentId) return done("failed", "payment_id_mismatch");

    return applyPayment(notification, known, fetched.payment);
  }

  async function alertResolution(notification: MpWebhookNotification, resolution: Resolution): Promise<void> {
    if (resolution.status !== "unverifiable" && resolution.status !== "failed") return;
    await alerts.send({
      kind: resolution.status === "unverifiable" ? "mp_webhook_unverifiable" : "mp_webhook_failed",
      message:
        resolution.status === "unverifiable"
          ? "Notificación de MP sin poder verificar contra MP (faltan o fallan las credenciales del transportista)"
          : "Notificación de MP que no se pudo procesar",
      context: {
        notificationId: notification.id,
        mpPaymentId: notification.mpPaymentId,
        holdId: notification.holdId,
        outcome: resolution.outcome,
        attempts: notification.attempts,
        lastError: resolution.lastError ?? null,
      },
    });
  }

  async function processNotification(id: string): Promise<void> {
    const claimedAt = now();
    const notification = await repo.claim(id, claimedAt, new Date(claimedAt.getTime() + CLAIM_LEASE_MS));
    if (!notification) return;

    let resolution: Resolution;
    try {
      resolution = await handle(notification);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!(error instanceof TransientError)) {
        log.error({ notificationId: id, err: error }, "error inesperado procesando la notificación de MP");
      }
      resolution =
        notification.attempts >= deps.maxAttempts
          ? { status: "failed", outcome: "max_attempts_reached", lastError: message }
          : {
              status: "pending",
              outcome: "retry_scheduled",
              lastError: message,
              nextAttemptAt: new Date(now().getTime() + retryDelayMs(notification.attempts)),
            };
    }

    await repo.resolve(id, resolution, now());
    log.info(
      { notificationId: id, mpPaymentId: notification.mpPaymentId, attempts: notification.attempts, ...resolution },
      "notificación de MP procesada"
    );
    await alertResolution(notification, resolution);
  }

  /** Corre el procesamiento sin que el caller lo espere, registrándolo para `drain`. */
  function runInBackground(id: string): void {
    const task = processNotification(id)
      .catch((error) => log.error({ notificationId: id, err: error }, "falló el procesamiento de la notificación de MP"))
      .finally(() => inFlight.delete(task));
    inFlight.add(task);
  }

  return {
    /**
     * Guarda la notificación y dispara su procesamiento en segundo plano. `false` si no
     * es del tópico `payment` o si ya se había recibido (reenvío de MP).
     */
    async receive(input: IncomingMpNotification): Promise<{ stored: boolean; notificationId: string | null }> {
      if (input.topic !== "payment") return { stored: false, notificationId: null };
      const row = await repo.insertIfNew(input);
      if (!row) {
        log.info({ mpNotificationId: input.mpNotificationId }, "notificación de MP repetida, se descarta");
        return { stored: false, notificationId: null };
      }
      runInBackground(row.id);
      return { stored: true, notificationId: row.id };
    },

    processNotification,

    /** Lo que corre el barrido: reintenta las notificaciones `pending` vencidas. */
    async processDue(limit = 50): Promise<number> {
      const ids = await repo.findDue(now(), limit);
      for (const id of ids) {
        await processNotification(id).catch((error) =>
          log.error({ notificationId: id, err: error }, "falló el reintento de la notificación de MP")
        );
      }
      return ids.length;
    },

    /** Espera lo que quedó corriendo en segundo plano (cierre del servicio y tests). */
    async drain(): Promise<void> {
      while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
    },
  };
}

export type MpWebhookService = ReturnType<typeof createMpWebhookService>;
