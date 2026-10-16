import {
  ApiError,
  NotificationTriggerKey,
  renderNotificationTrigger,
  SettlementDisplayStatus,
  SettlementResponse,
  ShipmentSettlementResponse,
  ShipmentStatus,
} from "@movo/shared";
import { NotificationsClient } from "../../adapters/notifications-client";
import { PaymentsClient } from "../../adapters/payments-client";
import { InvalidShipmentTransitionError } from "../../domain/shipment-state-machine";
import {
  PenaltyCursor,
  SettlementCursor,
  ShipmentConcurrentModificationError,
  ShipmentRepository,
} from "../../repositories/shipment-repository";
import { Shipment } from "../../models/shipment";
import { sendCustodyPush } from "../../utils/dispatch-push";

type SettlementLogger = {
  info?: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error?: (obj: unknown, msg?: string) => void;
};

export type CaptureOutcome =
  /** Capturó (o confirmó la captura) y el envío pasó a `completed` en esta llamada. */
  | "completed"
  /** El envío ya estaba `completed`: no se hizo nada. */
  | "already_completed"
  /** No corresponde capturar (no está `delivered`, no tiene transportista o no existe). */
  | "skipped";

/**
 * Estado de reintento por envío del barrido (en Redis): qué envíos están "enfriándose" tras un
 * fallo de captura. Sin esto el barrido reintentaba SIEMPRE los mismos envíos que nunca van a
 * poder capturarse y los demás quedaban sin atender.
 */
export interface SettlementRetryState {
  isCoolingDown(shipmentId: string): Promise<boolean>;
  /** Registra un intento fallido y arranca el enfriamiento (más largo cuanto más intentos). */
  recordFailure(shipmentId: string, permanent: boolean): Promise<void>;
  clear(shipmentId: string): Promise<void>;
}

/**
 * MOVO-307: resultado de cobrar la penalidad de una cancelación tardía.
 * - `captured`: se cobró del hold (captura parcial) en esta llamada.
 * - `debt`: no se pudo cobrar del hold y quedó como deuda en la cuenta corriente.
 * - `already_resolved`: ya estaba cobrada o registrada como deuda.
 * - `skipped`: el envío no tiene una penalidad pendiente.
 */
export type PenaltyOutcome = "captured" | "debt" | "already_resolved" | "skipped";

/**
 * MOVO-307: códigos de la captura de penalidad que mandan la penalidad a la cuenta corriente
 * en vez de reintentar. `CAPTURE_BELOW_APPLICATION_FEE` es el plan B (spike MOVO-305: MP no
 * captura un monto que no supere su comisión); los otros dos, un hold que ya no existe o venció.
 */
const PENALTY_TO_DEBT_CODES = new Set(["CAPTURE_BELOW_APPLICATION_FEE", "HOLD_NOT_FOUND", "HOLD_NOT_CAPTURABLE"]);

/** Códigos con los que `svc-payments` avisa que reintentar no sirve (sin hold / hold no capturable). */
const PERMANENT_CAPTURE_CODES = new Set(["HOLD_NOT_FOUND", "HOLD_NOT_CAPTURABLE"]);

/** Máximo de páginas que recorre una pasada del barrido para juntar `batchSize` envíos elegibles. */
const SWEEP_MAX_PAGES = 10;

const SWEEP_COOLDOWN_BASE_SECONDS = 10 * 60;
const SWEEP_COOLDOWN_MAX_SECONDS = 6 * 60 * 60;
const SWEEP_COOLDOWN_PERMANENT_SECONDS = 24 * 60 * 60;

/** Enfriamiento tras el intento fallido N: 10 min, 20, 40... hasta 6 h; un fallo permanente espera 24 h. */
export function settlementRetryCooldownSeconds(attempts: number, permanent: boolean): number {
  if (permanent) return SWEEP_COOLDOWN_PERMANENT_SECONDS;
  return Math.min(SWEEP_COOLDOWN_MAX_SECONDS, SWEEP_COOLDOWN_BASE_SECONDS * 2 ** Math.max(0, attempts - 1));
}

export interface SettlementServiceDeps {
  repository: ShipmentRepository;
  paymentsClient: PaymentsClient;
  notificationsClient?: NotificationsClient;
  logger?: SettlementLogger;
  /** Dedupe de los pushes entre réplicas (Redis `SET NX`), mismo molde que la saga de MOVO-210. */
  claimNotificationOnce?: (key: string, ttlSeconds: number) => Promise<boolean>;
  /** Enfriamiento por envío del barrido; sin él (tests) todos los candidatos se reintentan. */
  retryState?: SettlementRetryState;
  now?: () => Date;
}

const NOTIFICATION_DEDUPE_TTL_SECONDS = 7 * 24 * 60 * 60;

function displayStatus(settlement: SettlementResponse): SettlementDisplayStatus {
  if (settlement.status === "credited") return "credited";
  if (settlement.status === "escalated") return "escalated";
  // `processing` y `failed` se ven igual desde afuera: todavía se está cobrando.
  return "processing";
}

/**
 * MOVO-212: cierre económico de un envío entregado. `svc-shipments` es el dueño del estado
 * del envío; `svc-payments` solo cobra. Orden fijo: primero la captura, y solo con la
 * liquidación acreditada el envío pasa `delivered -> completed` (AC5, única transición que
 * produce `completed`).
 *
 * **AC8: la entrega ya ocurrió y es inmutable.** Si la captura falla, este servicio lanza y
 * el envío se queda en `delivered`: nunca hay una transición hacia atrás. El reintento
 * automático lo hace el barrido (`settlement-sweep`) y, si no alcanza, el escalado manual es
 * MOVO-213.
 *
 * **Idempotencia (AC7).** Llamarlo N veces es seguro: payments devuelve la misma liquidación
 * sin volver a cobrar, y la transición usa compare-and-swap contra `delivered`, así que solo
 * un llamador "gana" y dispara los pushes.
 */
export function createSettlementService(deps: SettlementServiceDeps) {
  const { repository, paymentsClient, notificationsClient, logger, claimNotificationOnce, retryState } = deps;

  /** MOVO-307: la penalidad no se pudo cobrar del hold y queda como deuda en la cuenta corriente. */
  async function resolveAsDebt(shipment: Shipment, penaltyArs: number, code: string): Promise<PenaltyOutcome> {
    const resolved = await repository.resolveCancellationPenalty(shipment.id, "debt");
    if (!resolved) return "already_resolved";
    logger?.warn(
      { event: "cancellation_penalty_debt", shipmentId: shipment.id, senderId: shipment.senderId, penaltyArs, code },
      "la penalidad de cancelación quedó como deuda en la cuenta corriente del emisor"
    );
    await notifyPenalty(shipment.id, shipment.senderId, "cancellationPenaltyDebtSender", { penaltyArs });
    return "debt";
  }

  /** Push de la penalidad. Sin dedupe en Redis: solo la manda quien ganó `resolveCancellationPenalty`. */
  async function notifyPenalty<K extends NotificationTriggerKey>(
    shipmentId: string,
    userId: string,
    triggerKey: K,
    params: Parameters<typeof renderNotificationTrigger<K>>[1]
  ): Promise<void> {
    if (!notificationsClient) return;
    await sendCustodyPush({
      notificationsClient,
      userId,
      triggerKey,
      params,
      data: { type: "shipment", shipmentId },
      logger,
      onErrorContext: {
        event: "notification_dispatch_failed",
        message: "No se pudo avisar la penalidad de cancelación",
        extra: { shipmentId },
      },
    });
  }

  async function notifyParties(
    shipment: { id: string; senderId: string; carrierId: string | null },
    settlement: SettlementResponse
  ): Promise<void> {
    if (!notificationsClient) return;
    if (claimNotificationOnce) {
      const claimed = await claimNotificationOnce(`settlement:${shipment.id}`, NOTIFICATION_DEDUPE_TTL_SECONDS);
      if (!claimed) return;
    }
    const data = { type: "shipment", shipmentId: shipment.id };
    const extra = { shipmentId: shipment.id };
    await Promise.all([
      shipment.carrierId && settlement.netAmountArs !== null
        ? sendCustodyPush({
            notificationsClient,
            userId: shipment.carrierId,
            triggerKey: "settlementCreditedCarrier",
            params: { netAmountArs: settlement.netAmountArs },
            data,
            logger,
            onErrorContext: {
              event: "notification_dispatch_failed",
              message: "No se pudo avisar al transportista que se acreditó el pago",
              extra,
            },
          })
        : Promise.resolve(),
      sendCustodyPush({
        notificationsClient,
        userId: shipment.senderId,
        triggerKey: "settlementProcessedSender",
        params: undefined,
        data,
        logger,
        onErrorContext: {
          event: "notification_dispatch_failed",
          message: "No se pudo avisar al emisor que el pago se procesó",
          extra,
        },
      }),
    ]);
  }

  return {
    /**
     * Captura el hold del envío y lo lleva a `completed`. Lanza si la captura falla (el envío
     * queda en `delivered`); los llamadores best-effort (notifier, barrido) lo atrapan.
     */
    async captureAndComplete(shipmentId: string): Promise<CaptureOutcome> {
      const shipment = await repository.findById(shipmentId);
      if (!shipment) return "skipped";
      if (shipment.status === ShipmentStatus.COMPLETED) return "already_completed";
      if (shipment.status !== ShipmentStatus.DELIVERED || !shipment.carrierId) return "skipped";

      const settlement = await paymentsClient.captureHold(shipmentId);
      if (settlement.status !== "credited") {
        // payments solo responde 200 con una liquidación acreditada; cualquier otra cosa es un
        // contrato roto, no un cobro: el envío no se completa.
        logger?.warn(
          { event: "settlement_not_credited", shipmentId, settlementStatus: settlement.status },
          "payments devolvió una liquidación no acreditada"
        );
        throw new ApiError(502, "PAYMENT_PROVIDER_ERROR", "La liquidación del envío no quedó acreditada.");
      }

      try {
        await repository.updateStatus(
          shipmentId,
          ShipmentStatus.COMPLETED,
          null,
          "Pago capturado y acreditado al transportista",
          { expectedFrom: ShipmentStatus.DELIVERED }
        );
      } catch (err) {
        if (err instanceof ShipmentConcurrentModificationError || err instanceof InvalidShipmentTransitionError) {
          // Otro llamador ganó la carrera: si el envío ya está `completed`, el objetivo se cumplió.
          const current = await repository.findById(shipmentId);
          if (current?.status === ShipmentStatus.COMPLETED) return "already_completed";
        }
        throw err;
      }

      logger?.info?.(
        { event: "shipment_completed", shipmentId, settlementId: settlement.id },
        "envío completado: hold capturado y pago acreditado"
      );
      await notifyParties(shipment, settlement);
      return "completed";
    },

    /**
     * MOVO-307 (ADR-047, AC6/AC9): cobra la penalidad de un envío cancelado con menos de 12 h.
     * Idempotente y retomable: la llaman la cancelación en línea y el barrido.
     *
     * Orden: (1) se registra la deuda en la cuenta corriente del emisor (`cancellation_penalty`);
     * (2) se captura esa parte del hold; (3) con la captura acreditada se registra el cobro
     * (`penalty_capture`, negativo y `settled`), así el saldo queda en cero. Si el hold no la
     * soporta (no supera la comisión, plan B) se libera entero; si venció o no existe, no hay
     * nada que liberar. En los dos casos la deuda queda y se cobra en la próxima operación
     * (MOVO-311). Un fallo transitorio (payments o MP caídos) lanza y la penalidad sigue
     * `pending` para el próximo intento. Las tres llamadas a payments son idempotentes.
     */
    async settleCancellationPenalty(shipmentId: string): Promise<PenaltyOutcome> {
      const shipment = await repository.findById(shipmentId);
      if (!shipment || shipment.status !== ShipmentStatus.CANCELLED || shipment.cancellationPenaltyArs === null) {
        return "skipped";
      }
      if (shipment.cancellationPenaltyStatus !== "pending") return "already_resolved";
      const penaltyArs = shipment.cancellationPenaltyArs;

      await paymentsClient.createLedgerEntry(shipment.senderId, {
        idempotencyKey: `penalty:${shipmentId}`,
        type: "cancellation_penalty",
        roleAtOrigin: "sender",
        amountArs: penaltyArs,
        shipmentId,
      });

      let settlement: SettlementResponse;
      try {
        settlement = await paymentsClient.captureHold(shipmentId, { kind: "cancellation_penalty", amountArs: penaltyArs });
      } catch (err) {
        const code = err instanceof ApiError ? err.code : undefined;
        if (code === undefined || !PENALTY_TO_DEBT_CODES.has(code)) throw err;
        if (code === "CAPTURE_BELOW_APPLICATION_FEE") {
          // Plan B: el hold sigue `authorized` y se libera entero. Si la liberación falla, lanza
          // y se reintenta; con la cuenta del transportista desvinculada no hay cómo liberarlo
          // (vence solo en MP), mismo criterio que `releaseHoldBeforeCancel`.
          try {
            await paymentsClient.releaseHold(shipmentId);
          } catch (releaseErr) {
            if (!(releaseErr instanceof ApiError && releaseErr.code === "CARRIER_MP_ACCOUNT_NOT_LINKED")) throw releaseErr;
            logger?.error?.(
              { err: releaseErr, event: "funding_hold_release_impossible", shipmentId },
              "No se pudo liberar el hold: la cuenta de MP del transportista no está vinculada, vence solo en MP"
            );
          }
        } else {
          logger?.error?.(
            { event: "cancellation_penalty_hold_unavailable", shipmentId, code, penaltyArs },
            "No se pudo cobrar la penalidad del hold (vencido o inexistente): queda como deuda del emisor"
          );
        }
        return resolveAsDebt(shipment, penaltyArs, code);
      }

      if (settlement.status !== "credited") {
        throw new ApiError(502, "PAYMENT_PROVIDER_ERROR", "La penalidad no quedó acreditada.");
      }
      await paymentsClient.createLedgerEntry(shipment.senderId, {
        idempotencyKey: `penalty_capture:${shipmentId}`,
        type: "penalty_capture",
        roleAtOrigin: "sender",
        amountArs: -settlement.grossAmountArs,
        status: "settled",
        shipmentId,
        holdId: settlement.holdId,
      });

      const resolved = await repository.resolveCancellationPenalty(shipmentId, "captured");
      if (!resolved) return "already_resolved";
      logger?.info?.(
        { event: "cancellation_penalty_captured", shipmentId, penaltyArs, netAmountArs: settlement.netAmountArs },
        "penalidad de cancelación cobrada del hold"
      );
      const netAmountArs = settlement.netAmountArs;
      await Promise.all([
        shipment.carrierId && netAmountArs !== null
          ? notifyPenalty(shipment.id, shipment.carrierId, "cancellationPenaltyCompensationCarrier", { netAmountArs })
          : Promise.resolve(),
        notifyPenalty(shipment.id, shipment.senderId, "cancellationPenaltyChargedSender", {
          penaltyArs: settlement.grossAmountArs,
        }),
      ]);
      return "captured";
    },

    /**
     * MOVO-307: para el barrido -- reintenta las penalidades `pending` de envíos cancelados hace
     * más de `graceMinutes` (para no pisar el cobro en línea). Mismo esqueleto que
     * `retryPendingSettlements`: cursor keyset, enfriamiento por envío y un fallo no frena a los demás.
     */
    async retryPendingPenalties(options: { graceMinutes: number; batchSize: number }): Promise<void> {
      const now = (deps.now ?? (() => new Date()))();
      const cancelledBefore = new Date(now.getTime() - options.graceMinutes * 60 * 1000);
      let cursor: PenaltyCursor | undefined;
      let attempted = 0;

      for (let page = 0; page < SWEEP_MAX_PAGES && attempted < options.batchSize; page += 1) {
        const pending = await repository.listCancelledAwaitingPenalty(cancelledBefore, options.batchSize, cursor);
        if (pending.length === 0) break;

        for (const shipment of pending) {
          if (shipment.lastStatusChangedAt) cursor = { cancelledAt: shipment.lastStatusChangedAt, id: shipment.id };
          if (attempted >= options.batchSize) break;
          if (retryState && (await retryState.isCoolingDown(shipment.id))) continue;

          attempted += 1;
          try {
            await this.settleCancellationPenalty(shipment.id);
            await retryState?.clear(shipment.id);
          } catch (err) {
            const code = err instanceof ApiError ? err.code : undefined;
            logger?.warn(
              { event: "cancellation_penalty_retry_failed", shipmentId: shipment.id, code, err },
              "no se pudo cobrar la penalidad de cancelación, queda para un próximo barrido"
            );
            await retryState?.recordFailure(shipment.id, false).catch(() => undefined);
          }
        }
        if (pending.length < options.batchSize) break;
      }
    },

    /**
     * AC10: liquidación de un envío, con visibilidad por rol. El transportista ve el desglose
     * completo; el emisor solo el total pagado y la fecha; el receptor (y cualquier ajeno) no
     * accede.
     */
    async getForUser(shipmentId: string, callerId: string): Promise<ShipmentSettlementResponse> {
      const shipment = await repository.findById(shipmentId);
      if (!shipment) throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");

      const isCarrier = shipment.carrierId === callerId;
      const isSender = shipment.senderId === callerId;
      if (!isCarrier && !isSender) {
        throw new ApiError(403, "AUTH_FORBIDDEN", "No tenés acceso al pago de este envío.");
      }

      const settlement = await paymentsClient.findSettlement(shipmentId);
      if (!settlement) throw new ApiError(404, "SETTLEMENT_NOT_FOUND", "Este envío todavía no tiene un pago liquidado.");

      const base: ShipmentSettlementResponse = {
        shipmentId,
        role: isCarrier ? "carrier" : "sender",
        kind: settlement.kind,
        status: displayStatus(settlement),
        paidAmountArs: settlement.grossAmountArs,
        paidAt: settlement.status === "credited" ? settlement.capturedAt : null,
      };
      if (!isCarrier) return base;
      return {
        ...base,
        mpFeeArs: settlement.mpFeeArs,
        commissionArs: settlement.commissionArs,
        netAmountArs: settlement.netAmountArs,
      };
    },

    /**
     * Para el barrido: reintenta la captura de los `delivered` que no se cerraron. Un fallo
     * de un envío no frena a los demás. Recorre los candidatos con un cursor keyset y se salta
     * los que están enfriándose tras un fallo reciente, así una pila de envíos imposibles de
     * capturar (sin hold, hold vencido, cuenta desvinculada) no tapa a los que sí se pueden cobrar.
     */
    async retryPendingSettlements(options: { graceMinutes: number; batchSize: number }): Promise<void> {
      const now = (deps.now ?? (() => new Date()))();
      const deliveredBefore = new Date(now.getTime() - options.graceMinutes * 60 * 1000);
      let cursor: SettlementCursor | undefined;
      let attempted = 0;

      for (let page = 0; page < SWEEP_MAX_PAGES && attempted < options.batchSize; page += 1) {
        const pending = await repository.listDeliveredAwaitingSettlement(deliveredBefore, options.batchSize, cursor);
        if (pending.length === 0) break;

        for (const shipment of pending) {
          if (shipment.deliveredAt) cursor = { deliveredAt: shipment.deliveredAt, id: shipment.id };
          if (attempted >= options.batchSize) break;
          if (retryState && (await retryState.isCoolingDown(shipment.id))) continue;

          attempted += 1;
          try {
            await this.captureAndComplete(shipment.id);
            await retryState?.clear(shipment.id);
          } catch (err) {
            const code = err instanceof ApiError ? err.code : undefined;
            const permanent = code !== undefined && PERMANENT_CAPTURE_CODES.has(code);
            // Un `delivered` sin hold (asignado antes de la saga de pagos) no tiene nada que
            // capturar: se deja registrado y se sigue, no es un fallo de cobro.
            logger?.warn(
              { event: "settlement_retry_failed", shipmentId: shipment.id, code, permanent, err },
              code === "HOLD_NOT_FOUND"
                ? "envío entregado sin hold: no hay nada que capturar"
                : "no se pudo capturar el pago del envío entregado, queda para un próximo barrido"
            );
            await retryState?.recordFailure(shipment.id, permanent).catch(() => undefined);
          }
        }
        if (pending.length < options.batchSize) break;
      }
    },
  };
}

export type SettlementService = ReturnType<typeof createSettlementService>;
