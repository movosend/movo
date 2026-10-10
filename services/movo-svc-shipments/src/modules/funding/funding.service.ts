import {
  ApiError,
  HoldFailureReason,
  HoldProviderEventRequest,
  HoldResponse,
  LIVE_HOLD_STATUSES,
  NotificationTriggerKey,
  OfferStatus,
  ShipmentFundingRequest,
  ShipmentFundingResponse,
  ShipmentFundingResult,
  ShipmentStatus,
} from "@movo/shared";
import { FastifyBaseLogger } from "fastify";
import { NotificationsClient } from "../../adapters/notifications-client";
import { PaymentsClient } from "../../adapters/payments-client";
import { UsersClient } from "../../adapters/users-client";
import {
  farRouteFundingDeadline,
  isFundingWindowOpen,
  nearRouteFundingDeadline,
  reminderBucket,
} from "../../domain/funding";
import { anchorTimeOfDayToInstant, pickupWindowEndInstant } from "../../domain/pickup-window";
import { InvalidShipmentTransitionError } from "../../domain/shipment-state-machine";
import { Shipment } from "../../models/shipment";
import { OfferRepository } from "../../repositories/offer-repository";
import { ShipmentConcurrentModificationError, ShipmentRepository } from "../../repositories/shipment-repository";
import { sendCustodyPush } from "../../utils/dispatch-push";
import { assertIsSender } from "../shipments/assert-shipment-access";

/**
 * MOVO-210: configuración de la saga (todo viene de env, MOVO-215 fija los valores reales).
 */
export interface FundingConfig {
  /** "N": retiro dentro de N días = ruta cercana; a más, ruta lejana. */
  nearPickupDays: number;
  /** AC5: plazo del pago de la ruta cercana desde que se acepta la oferta. */
  paymentTimeoutMinutes: number;
  /** AC9: la ruta lejana vuelve a `published` a estas horas antes del inicio del retiro. */
  releaseHoursBeforePickup: number;
  /** AC7: cada cuántas horas se recuerda el pago con la ventana abierta. */
  reminderIntervalHours: number;
}

type FundingLogger =
  | FastifyBaseLogger
  | {
      info: (obj: unknown, msg?: string) => void;
      warn: (obj: unknown, msg?: string) => void;
      error: (obj: unknown, msg?: string) => void;
    };

export interface FundingServiceDeps {
  repository: ShipmentRepository;
  usersClient: UsersClient;
  paymentsClient: PaymentsClient;
  config: FundingConfig;
  /** Para avisar a los transportistas cuya oferta se cierra al confirmarse el hold (AC4). */
  offerRepository?: OfferRepository;
  notificationsClient?: NotificationsClient;
  logger?: FundingLogger;
  /** Dedupe de avisos de los barridos (Redis `SET NX`), mismo contrato que MOVO-258 D6. */
  claimNotificationOnce?: (key: string, ttlSeconds: number) => Promise<boolean>;
  releaseNotificationClaim?: (key: string) => Promise<void>;
}

const SWEEP_PAGE_SIZE = 100;
const SWEEP_MAX_PAGES = 20;
const HOUR_MS = 60 * 60 * 1000;
const DAY_SECONDS = 24 * 60 * 60;

/** Un hold con fondos efectivamente reservados (la saga lo cuenta como "pagado"). */
function isFundedHold(hold: HoldResponse): boolean {
  return hold.status === "authorized" || hold.status === "captured";
}

type SettleOutcome = "funded" | "proceed" | "retry";

/**
 * AC12: libera el hold de un envío que se cancela. `null` en payments = nunca hubo hold
 * (nada que liberar). Si el transportista desvinculó su cuenta de MP la liberación es
 * imposible (limitación documentada de MOVO-209): el hold vence solo y NO se bloquea la
 * cancelación, pero queda logueado con el `holdId`. Cualquier otra falla se propaga:
 * cancelar sin poder liberar dejaría fondos del emisor retenidos sin dueño.
 */
export async function releaseHoldBeforeCancel(
  paymentsClient: PaymentsClient,
  shipmentId: string,
  logger?: FundingLogger,
): Promise<void> {
  try {
    await paymentsClient.releaseHold(shipmentId);
  } catch (err) {
    if (err instanceof ApiError && err.code === "CARRIER_MP_ACCOUNT_NOT_LINKED") {
      logger?.error(
        { err, event: "funding_hold_release_impossible", shipmentId },
        "No se pudo liberar el hold: la cuenta de MP del transportista no está vinculada, vence solo en MP",
      );
      return;
    }
    throw err;
  }
}

export function createFundingService(deps: FundingServiceDeps) {
  const { repository, usersClient, paymentsClient, config, notificationsClient, logger, offerRepository } = deps;

  const pickupStartOf = (shipment: Shipment): Date =>
    anchorTimeOfDayToInstant(shipment.pickupDate, shipment.pickupTimeWindowStart);

  /** Hasta cuándo puede pagar el emisor en el estado actual del envío. */
  function payUntilOf(shipment: Shipment): Date {
    if (shipment.status === ShipmentStatus.ASSIGNMENT_PENDING) {
      return nearRouteFundingDeadline(
        shipment.lastStatusChangedAt ?? shipment.updatedAt,
        config.paymentTimeoutMinutes,
        pickupWindowEndInstant(shipment.pickupDate, shipment.pickupTimeWindowEnd),
      );
    }
    // Ruta lejana: T-24h del retiro. Piso: el mismo margen de pago que tiene la ruta
    // cercana desde que el envío ENTRÓ a este estado. Sin él, un hold perdido a menos de 24h
    // del retiro (`assigned -> assigned_unfunded`, reconfirmación) llegaría con el plazo ya
    // vencido y el barrido lo devolvería a `published` antes de que el emisor pueda pagar.
    // En una ruta lejana normal no cambia nada: entró días antes de T-24h.
    const farDeadline = farRouteFundingDeadline(pickupStartOf(shipment), config.releaseHoursBeforePickup);
    const reconfirmFloor = nearRouteFundingDeadline(
      shipment.lastStatusChangedAt ?? shipment.updatedAt,
      config.paymentTimeoutMinutes,
      pickupWindowEndInstant(shipment.pickupDate, shipment.pickupTimeWindowEnd),
    );
    return farDeadline > reconfirmFloor ? farDeadline : reconfirmFloor;
  }

  /**
   * AC1/AC2: ¿puede el emisor pagar AHORA? Solo `assignment_pending` (hasta el plazo) o
   * `assigned_unfunded` con la ventana abierta y sin vencer.
   */
  function assertFundable(shipment: Shipment, now: Date): { route: "near" | "far"; payUntil: Date } {
    const notAvailable = (message: string) =>
      new ApiError(409, "SHIPMENT_FUNDING_NOT_AVAILABLE", message);

    if (shipment.carrierId === null || shipment.agreedPriceArs === null) {
      throw notAvailable("El envío no tiene un transportista asignado para pagar.");
    }

    if (shipment.status === ShipmentStatus.ASSIGNMENT_PENDING) {
      const payUntil = payUntilOf(shipment);
      if (payUntil <= now) {
        throw notAvailable("El plazo para pagar este envío venció.");
      }
      return { route: "near", payUntil };
    }

    if (shipment.status === ShipmentStatus.ASSIGNED_UNFUNDED) {
      if (!isFundingWindowOpen(pickupStartOf(shipment), config.nearPickupDays, now)) {
        throw notAvailable("Todavía no se abrió la ventana para confirmar el pago de este envío.");
      }
      const payUntil = payUntilOf(shipment);
      if (payUntil <= now) {
        throw notAvailable("El plazo para confirmar el pago de este envío venció.");
      }
      return { route: "far", payUntil };
    }

    throw notAvailable("El envío no está esperando un pago.");
  }

  async function loadShipmentForSender(shipmentId: string, callerId: string): Promise<Shipment> {
    const shipment = await repository.findById(shipmentId);
    if (!shipment) {
      throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");
    }
    assertIsSender(shipment, callerId, "Solo el emisor del envío puede pagarlo.");
    return shipment;
  }

  async function resolvePayerEmail(senderId: string): Promise<string> {
    const email = await usersClient.findAccountEmail(senderId);
    if (!email) {
      throw new ApiError(502, "USERS_SERVICE_UNAVAILABLE", "No se pudo resolver el email de la cuenta del emisor.");
    }
    return email;
  }

  async function notify<K extends NotificationTriggerKey>(
    userId: string | null,
    triggerKey: K,
    params: Parameters<typeof sendCustodyPush<K>>[0]["params"],
    shipmentId: string,
  ): Promise<void> {
    if (!notificationsClient || !userId) {
      return;
    }
    await sendCustodyPush({
      notificationsClient,
      userId,
      triggerKey,
      params,
      data: { type: "shipment", shipmentId },
      logger,
      onErrorContext: {
        event: "notification_dispatch_failed",
        message: "No se pudo enviar la push de la saga de asignación",
        extra: { shipmentId, triggerKey },
      },
    });
  }

  async function notifyFunded(shipment: Shipment): Promise<void> {
    await Promise.all([
      notify(shipment.senderId, "fundingConfirmedSender", undefined, shipment.id),
      notify(shipment.carrierId, "fundingConfirmedCarrier", undefined, shipment.id),
    ]);
  }

  /** Aviso al transportista cuya oferta se cerró porque el emisor confirmó el pago a otro. */
  async function notifyOfferClosed(offerId: string, carrierId: string, shipmentId: string): Promise<void> {
    if (!notificationsClient) {
      return;
    }
    await sendCustodyPush({
      notificationsClient,
      userId: carrierId,
      triggerKey: "offerSuperseded",
      params: undefined,
      data: { type: "offer_superseded", shipmentId, offerId },
      logger,
      onErrorContext: {
        event: "notification_dispatch_failed",
        message: "No se pudo avisar al transportista que su oferta se cerró",
        extra: { shipmentId, offerId },
      },
    });
  }

  /**
   * Pasa el envío a `assigned` (hold confirmado) por la máquina de estados, cierra las demás
   * ofertas en la misma transacción (AC4) y avisa a las dos partes y a los transportistas
   * desplazados. El UPDATE condiciona por el estado, el transportista y el precio con los que se
   * creó el hold: si el envío ya es otra asignación, no se confirma. Idempotente ante el doble
   * tap / una reconciliación concurrente (AC14): si otra llamada ya lo dejó `assigned`, devuelve
   * `false` sin error. Cualquier otro estado final es un conflicto real.
   */
  async function markAssigned(shipment: Shipment, actorId: string | null, reason: string): Promise<boolean> {
    const closingOffers = offerRepository
      ? (await offerRepository.listByShipment(shipment.id)).filter((offer) => offer.status === OfferStatus.PENDING)
      : [];
    try {
      await repository.updateStatus(shipment.id, ShipmentStatus.ASSIGNED, actorId, reason, {
        expectedFrom: shipment.status,
        ...(shipment.carrierId !== null && { expectedCarrierId: shipment.carrierId }),
        ...(shipment.agreedPriceArs !== null && { expectedAgreedPriceArs: shipment.agreedPriceArs }),
      });
    } catch (err) {
      if (err instanceof ShipmentConcurrentModificationError || err instanceof InvalidShipmentTransitionError) {
        const fresh = await repository.findById(shipment.id);
        if (fresh?.status === ShipmentStatus.ASSIGNED && fresh.carrierId === shipment.carrierId) {
          return false;
        }
      }
      throw err;
    }
    void notifyFunded(shipment);
    for (const offer of closingOffers) {
      void notifyOfferClosed(offer.id, offer.carrierId, shipment.id);
    }
    return true;
  }

  type SenderTrigger = "fundingTimedOutSender" | "fundingWindowExpiredSender";
  type CarrierTrigger = "fundingTimedOutCarrier" | "fundingWindowExpiredCarrier";

  /**
   * Estado del hold de un envío que espera el pago, sin esperar a que venza el plazo:
   * `funded` (autorizado: hay que confirmar la asignación), `live` (MP lo tiene en revisión),
   * `none` (sin hold vivo) o `error` (no se pudo consultar a payments: no se decide nada).
   * Un hold `in_process` se sincroniza con MP en cada vuelta: en la ruta lejana el emisor que
   * ya pagó no tiene que recibir recordatorios de "falta pagar" durante días.
   */
  async function reconcileLiveHold(shipment: Shipment): Promise<"funded" | "live" | "none" | "error"> {
    try {
      let hold = await paymentsClient.findHoldByShipment(shipment.id);
      if (!hold) {
        return "none";
      }
      if (isFundedHold(hold)) {
        return "funded";
      }
      if (hold.status !== "in_process" && hold.status !== "creating") {
        return "none";
      }
      hold = (await paymentsClient.findHoldByShipment(shipment.id, { sync: true })) ?? hold;
      if (isFundedHold(hold)) {
        return "funded";
      }
      return LIVE_HOLD_STATUSES.includes(hold.status) ? "live" : "none";
    } catch (err) {
      logger?.warn(
        { err, event: "funding_hold_lookup_failed", shipmentId: shipment.id },
        "No se pudo consultar el hold del envío: se reintenta en el próximo barrido",
      );
      return "error";
    }
  }

  /**
   * Antes de revertir una asignación: ¿el hold ya está autorizado (se cobra la reconciliación
   * en vez de revertir), hay que liberarlo, o no hay nada? `retry` = no se pudo confirmar el
   * estado del hold, el barrido lo reintenta (revertir a ciegas dejaría un hold vivo que
   * bloquea la próxima asignación del envío).
   */
  async function settleHoldBeforeRevert(shipment: Shipment): Promise<SettleOutcome> {
    let hold: HoldResponse | null;
    try {
      hold = await paymentsClient.findHoldByShipment(shipment.id, { sync: true });
    } catch (err) {
      logger?.warn(
        { err, event: "funding_hold_lookup_failed", shipmentId: shipment.id },
        "No se pudo consultar el hold del envío: se reintenta en el próximo barrido",
      );
      return "retry";
    }
    if (!hold) {
      return "proceed";
    }
    if (isFundedHold(hold)) {
      return "funded";
    }
    if (LIVE_HOLD_STATUSES.includes(hold.status)) {
      try {
        await releaseHoldBeforeCancel(paymentsClient, shipment.id, logger);
      } catch (err) {
        logger?.warn(
          { err, event: "funding_hold_release_failed", shipmentId: shipment.id, holdId: hold.id },
          "No se pudo liberar el hold del envío: se reintenta en el próximo barrido",
        );
        return "retry";
      }
    }
    return "proceed";
  }

  /** Devuelve el envío a `published` y avisa a las dos partes (AC5/AC9/AC13/AC17). */
  async function revertToPublished(
    shipment: Shipment,
    reason: string,
    triggers: { sender: SenderTrigger; carrier: CarrierTrigger },
  ): Promise<void> {
    const carrierId = shipment.carrierId;
    // El UPDATE condiciona por el estado que se evaluó: si el envío cambió en el medio (se
    // pagó, se canceló, lo tomó otra asignación) no se revierte a ciegas.
    await repository.updateStatus(shipment.id, ShipmentStatus.PUBLISHED, null, reason, {
      expectedFrom: shipment.status,
      ...(shipment.carrierId !== null && { expectedCarrierId: shipment.carrierId }),
    });
    await Promise.all([
      notify(shipment.senderId, triggers.sender, undefined, shipment.id),
      notify(carrierId, triggers.carrier, undefined, shipment.id),
    ]);
  }

  async function forEachByStatus(
    status: ShipmentStatus,
    visit: (shipment: Shipment) => Promise<void>,
  ): Promise<void> {
    let afterId: string | undefined;
    for (let page = 0; page < SWEEP_MAX_PAGES; page++) {
      const batch = await repository.findByStatus(status, SWEEP_PAGE_SIZE, afterId);
      for (const shipment of batch) {
        await visit(shipment);
      }
      if (batch.length < SWEEP_PAGE_SIZE) {
        return;
      }
      afterId = batch[batch.length - 1].id;
    }
  }

  return {
    /** AC1: `GET /shipments/:id/funding`. */
    async getFunding(shipmentId: string, callerId: string, now: Date = new Date()): Promise<ShipmentFundingResponse> {
      const shipment = await loadShipmentForSender(shipmentId, callerId);
      const { route, payUntil } = assertFundable(shipment, now);

      const checkout = await paymentsClient.getCheckoutData({
        shipmentId: shipment.id,
        carrierId: shipment.carrierId as string,
        amountArs: shipment.agreedPriceArs as number,
        payerEmail: await resolvePayerEmail(shipment.senderId),
      });

      return {
        shipmentId: shipment.id,
        route,
        carrierPublicKey: checkout.publicKey,
        amountArs: checkout.amountArs,
        payUntil: payUntil.toISOString(),
      };
    },

    /**
     * AC2/AC4/AC8/AC14: `POST /shipments/:id/funding`. Crea (o recupera, idempotente por
     * envío en payments) el hold y, si quedó autorizado, transiciona a `assigned`. Un
     * rechazo NO cambia el estado: el emisor reintenta con otra tarjeta mientras no venza.
     */
    async submitFunding(
      shipmentId: string,
      callerId: string,
      input: ShipmentFundingRequest,
      now: Date = new Date(),
    ): Promise<ShipmentFundingResult> {
      const shipment = await loadShipmentForSender(shipmentId, callerId);

      // AC14: doble tap / reintento de red sobre un pago que ya se confirmó.
      if (shipment.status === ShipmentStatus.ASSIGNED && shipment.carrierId !== null) {
        return {
          shipmentId: shipment.id,
          funded: true,
          shipmentStatus: ShipmentStatus.ASSIGNED,
          failureReason: null,
          payUntil: null,
        };
      }

      const { payUntil } = assertFundable(shipment, now);

      const hold = await paymentsClient.createHold({
        shipmentId: shipment.id,
        carrierId: shipment.carrierId as string,
        cardToken: input.cardToken,
        amountArs: shipment.agreedPriceArs as number,
        payerEmail: await resolvePayerEmail(shipment.senderId),
        ...(input.paymentMethodId ? { paymentMethodId: input.paymentMethodId } : {}),
      });

      if (!isFundedHold(hold)) {
        // `rejected`/`cancelled`: motivo diferenciado. `creating`/`in_process`: MP todavía no
        // resolvió -- sin motivo, el estado no cambia y el barrido reconcilia al vencer el plazo.
        const failureReason: HoldFailureReason | null = hold.failureReason;
        return {
          shipmentId: shipment.id,
          funded: false,
          shipmentStatus: shipment.status,
          failureReason,
          payUntil: payUntil.toISOString(),
        };
      }

      try {
        await markAssigned(shipment, callerId, "Reserva de fondos confirmada");
      } catch (err) {
        // El hold quedó autorizado pero el envío ya no puede pasar a `assigned` (se canceló o
        // el barrido lo revirtió en el medio): se libera para no dejar fondos retenidos.
        try {
          await releaseHoldBeforeCancel(paymentsClient, shipment.id, logger);
        } catch (releaseErr) {
          logger?.error(
            { err: releaseErr, event: "funding_orphan_hold", shipmentId: shipment.id, holdId: hold.id },
            "Hold autorizado sin envío asignable y no se pudo liberar",
          );
        }
        if (err instanceof ShipmentConcurrentModificationError || err instanceof InvalidShipmentTransitionError) {
          throw new ApiError(
            409,
            "SHIPMENT_FUNDING_NOT_AVAILABLE",
            "El envío cambió de estado mientras se procesaba el pago.",
          );
        }
        throw err;
      }

      return {
        shipmentId: shipment.id,
        funded: true,
        shipmentStatus: ShipmentStatus.ASSIGNED,
        failureReason: null,
        payUntil: null,
      };
    },

    /**
     * AC5: barrido de la ruta cercana. Un `assignment_pending` cuyo plazo de pago venció
     * vuelve a `published` (la oferta deja de estar aceptada, ver `updateStatus`), se libera
     * cualquier hold colgado y se avisa a las dos partes. Antes de revertir reconcilia con
     * payments: un hold que quedó autorizado sin que el envío lo supiera se confirma en vez
     * de perderse.
     */
    async expireUnpaidAssignmentPending(now: Date = new Date()): Promise<{ revertedCount: number; fundedCount: number; errorsCount: number }> {
      let revertedCount = 0;
      let fundedCount = 0;
      let errorsCount = 0;

      await forEachByStatus(ShipmentStatus.ASSIGNMENT_PENDING, async (shipment) => {
        try {
          // Un hold que MP dejó `in_process` y después autorizó se confirma en esta vuelta, sin
          // esperar al vencimiento del plazo.
          const live = await reconcileLiveHold(shipment);
          if (live === "funded") {
            if (await markAssigned(shipment, null, "Reserva de fondos confirmada (reconciliación)")) {
              fundedCount++;
            }
            return;
          }
          if (payUntilOf(shipment) > now) {
            return;
          }
          const outcome = await settleHoldBeforeRevert(shipment);
          if (outcome === "retry") {
            return;
          }
          if (outcome === "funded") {
            if (await markAssigned(shipment, null, "Reserva de fondos confirmada (reconciliación)")) {
              fundedCount++;
            }
            return;
          }
          await revertToPublished(shipment, "El emisor no completó el pago dentro del plazo", {
            sender: "fundingTimedOutSender",
            carrier: "fundingTimedOutCarrier",
          });
          revertedCount++;
        } catch (err) {
          errorsCount++;
          logger?.error(
            { err, event: "funding_timeout_sweep_error", shipmentId: shipment.id },
            "Error al revertir un envío con el pago vencido en barrido",
          );
        }
      });

      if (revertedCount + fundedCount + errorsCount > 0) {
        logger?.info(
          { event: "funding_timeout_sweep", revertedCount, fundedCount, errorsCount },
          `Barrido de timeout de pago finalizado: ${revertedCount} revertidos, ${fundedCount} reconciliados, ${errorsCount} fallos`,
        );
      }
      return { revertedCount, fundedCount, errorsCount };
    },

    /**
     * AC7/AC9/AC11: barrido de la ruta lejana sobre `assigned_unfunded`.
     * - A T-24h del retiro sin pago: vuelve a `published` y avisa a las dos partes.
     * - Con la ventana abierta: aviso inicial al emisor ("Confirmá el pago") y al
     *   transportista (pago pendiente), más recordatorios cada `reminderIntervalHours`.
     * Un `assigned_unfunded` que llega a la hora del retiro nunca pasa a `in_transit` (lo
     * impide la máquina de estados): si se detecta, además de revertirlo se loguea un
     * error `funding_missed_pickup` (el sweep estaba caído o `releaseHours` es 0).
     */
    async processUnfundedAssignments(now: Date = new Date()): Promise<{
      revertedCount: number;
      fundedCount: number;
      openedCount: number;
      remindedCount: number;
      errorsCount: number;
    }> {
      let revertedCount = 0;
      let fundedCount = 0;
      let openedCount = 0;
      let remindedCount = 0;
      let errorsCount = 0;
      const claim = deps.claimNotificationOnce;

      await forEachByStatus(ShipmentStatus.ASSIGNED_UNFUNDED, async (shipment) => {
        try {
          const pickupStart = pickupStartOf(shipment);
          const deadline = payUntilOf(shipment);

          const live = await reconcileLiveHold(shipment);
          if (live === "funded") {
            if (await markAssigned(shipment, null, "Reserva de fondos confirmada (reconciliación)")) {
              fundedCount++;
            }
            return;
          }

          if (deadline <= now) {
            const outcome = await settleHoldBeforeRevert(shipment);
            if (outcome === "retry") {
              return;
            }
            if (outcome === "funded") {
              if (await markAssigned(shipment, null, "Reserva de fondos confirmada (reconciliación)")) {
                fundedCount++;
              }
              return;
            }
            if (pickupStart <= now) {
              logger?.error(
                { event: "funding_missed_pickup", shipmentId: shipment.id, carrierId: shipment.carrierId },
                "Llegó la hora del retiro con el pago sin confirmar",
              );
            }
            await revertToPublished(
              shipment,
              "Sin pago a T-24h del retiro: venció la ventana de confirmación",
              { sender: "fundingWindowExpiredSender", carrier: "fundingWindowExpiredCarrier" },
            );
            revertedCount++;
            return;
          }

          // Con un hold vivo el emisor ya pagó y MP lo está revisando: ni "Confirmá el pago" ni
          // recordatorios (el transportista tampoco necesita el aviso de pago pendiente).
          if (live === "live") {
            return;
          }

          if (!isFundingWindowOpen(pickupStart, config.nearPickupDays, now) || !claim) {
            return;
          }

          const openedKey = `funding-window-opened:${shipment.id}`;
          if (await claim(openedKey, 30 * DAY_SECONDS)) {
            try {
              await Promise.all([
                notify(shipment.senderId, "fundingWindowOpenedSender", undefined, shipment.id),
                notify(shipment.carrierId, "fundingPendingCarrier", undefined, shipment.id),
              ]);
              openedCount++;
              // El aviso de apertura ya es el "recordatorio" de esta cubeta: sin reclamarla,
              // el barrido siguiente mandaría un segundo aviso a los 5 minutos.
              await claim(
                `funding-reminder:${shipment.id}:${reminderBucket(now, config.reminderIntervalHours)}`,
                Math.max(1, config.reminderIntervalHours) * 3600 * 2,
              );
            } catch (err) {
              await deps.releaseNotificationClaim?.(openedKey);
              throw err;
            }
            return;
          }

          const bucket = reminderBucket(now, config.reminderIntervalHours);
          const reminderKey = `funding-reminder:${shipment.id}:${bucket}`;
          if (await claim(reminderKey, Math.max(1, config.reminderIntervalHours) * 3600 * 2)) {
            await notify(
              shipment.senderId,
              "fundingReminderSender",
              { hoursLeft: (deadline.getTime() - now.getTime()) / HOUR_MS },
              shipment.id,
            );
            remindedCount++;
          }
        } catch (err) {
          errorsCount++;
          logger?.error(
            { err, event: "funding_window_sweep_error", shipmentId: shipment.id },
            "Error al procesar la ventana de confirmación de pago en barrido",
          );
        }
      });

      if (revertedCount + fundedCount + openedCount + remindedCount + errorsCount > 0) {
        logger?.info(
          { event: "funding_window_sweep", revertedCount, fundedCount, openedCount, remindedCount, errorsCount },
          "Barrido de la ventana de confirmación de pago finalizado",
        );
      }
      return { revertedCount, fundedCount, openedCount, remindedCount, errorsCount };
    },

    /**
     * AC13: `svc-payments` avisa que MP canceló, venció o rechazó un hold del envío
     * (MOVO-268). Solo actúa si el hold del aviso es el vigente (un aviso tardío de un
     * intento anterior no puede tirar abajo una reserva nueva) y el envío todavía espera
     * o acaba de recibir ese pago. Idempotente: un aviso repetido no encuentra nada que hacer.
     */
    async handleHoldProviderEvent(
      shipmentId: string,
      event: HoldProviderEventRequest,
    ): Promise<{ handled: boolean; outcome: string }> {
      const shipment = await repository.findById(shipmentId);
      if (!shipment) {
        throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");
      }

      const current = await paymentsClient.findHoldByShipment(shipmentId);
      if (!current || current.id !== event.holdId) {
        return { handled: false, outcome: "stale_hold" };
      }
      if (isFundedHold(current) || LIVE_HOLD_STATUSES.includes(current.status)) {
        return { handled: false, outcome: "hold_still_live" };
      }

      const reasonDetail = `${event.event}${event.statusDetail ? `: ${event.statusDetail}` : ""}`;

      // Un rechazo de la tarjeta no pierde la asignación: el emisor ya recibió el motivo en
      // la respuesta del pago y reintenta con otra tarjeta hasta que venza el plazo.
      if (event.event === "rejected") {
        return { handled: false, outcome: "rejected_retry_allowed" };
      }

      const attemptFailedKey = `funding-attempt-failed:${event.holdId}`;

      if (shipment.status === ShipmentStatus.ASSIGNED) {
        // El pago ya estaba confirmado y MP perdió la reserva: el envío NO se libera, vuelve a
        // `assigned_unfunded` y el emisor reconfirma dentro de la misma ventana de confirmación.
        // Si no paga a tiempo, el barrido lo devuelve a `published` como cualquier otro.
        try {
          await repository.updateStatus(
            shipment.id,
            ShipmentStatus.ASSIGNED_UNFUNDED,
            null,
            `La reserva de fondos se perdió (${reasonDetail}): se pide reconfirmar el pago`,
            { expectedFrom: ShipmentStatus.ASSIGNED },
          );
        } catch (err) {
          if (err instanceof ShipmentConcurrentModificationError || err instanceof InvalidShipmentTransitionError) {
            return { handled: false, outcome: "status_changed_concurrently" };
          }
          throw err;
        }
        // Este aviso reemplaza al de "se abrió la ventana", al primer recordatorio y al de
        // "intento fallido": se reclaman sus marcas para que no llegue un segundo push a los
        // minutos.
        if (deps.claimNotificationOnce) {
          await deps.claimNotificationOnce(`funding-window-opened:${shipment.id}`, 30 * DAY_SECONDS);
          await deps.claimNotificationOnce(
            `funding-reminder:${shipment.id}:${reminderBucket(new Date(), config.reminderIntervalHours)}`,
            Math.max(1, config.reminderIntervalHours) * 3600 * 2,
          );
          await deps.claimNotificationOnce(attemptFailedKey, 7 * DAY_SECONDS);
        }
        await Promise.all([
          notify(shipment.senderId, "fundingReconfirmSender", undefined, shipment.id),
          notify(shipment.carrierId, "fundingReconfirmCarrier", undefined, shipment.id),
        ]);
        return { handled: true, outcome: "reconfirmation_requested" };
      }

      // Mismo trato que un rechazo: un `cancelled`/`expired` mientras el envío espera el pago NO lo
      // revierte. El emisor todavía puede reintentar y el barrido gobierna el plazo (y reconcilia
      // el hold antes de revertir, así que no se pierde nada). Se le avisa UNA vez por hold que su
      // intento no prosperó para que vuelva a pagar.
      if (
        shipment.status === ShipmentStatus.ASSIGNMENT_PENDING ||
        shipment.status === ShipmentStatus.ASSIGNED_UNFUNDED
      ) {
        const firstTime = deps.claimNotificationOnce
          ? await deps.claimNotificationOnce(attemptFailedKey, 7 * DAY_SECONDS)
          : false;
        if (firstTime) {
          await notify(shipment.senderId, "fundingAttemptFailedSender", undefined, shipment.id);
        }
        return { handled: false, outcome: "awaiting_payment" };
      }

      // Con el paquete ya retirado o entregado no hay estado al que volver: el transportista
      // no va a poder cobrar si el hold no se puede capturar (MOVO-212). Queda como error
      // detectable, con evento propio, hasta que MOVO-212/MOVO-268 definan qué hace la captura.
      if (shipment.status === ShipmentStatus.IN_TRANSIT || shipment.status === ShipmentStatus.DELIVERED) {
        logger?.error(
          {
            event: "funding_hold_lost_in_transit",
            shipmentId,
            holdId: event.holdId,
            kind: event.event,
            shipmentStatus: shipment.status,
          },
          "MP canceló/venció el hold de un envío ya retirado: el cobro al entregar puede fallar",
        );
        return { handled: false, outcome: "hold_lost_after_pickup" };
      }

      return { handled: false, outcome: "status_not_applicable" };
    },
  };
}

export type FundingService = ReturnType<typeof createFundingService>;
