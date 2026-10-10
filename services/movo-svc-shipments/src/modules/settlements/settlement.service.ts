import {
  ApiError,
  SettlementDisplayStatus,
  SettlementResponse,
  ShipmentSettlementResponse,
  ShipmentStatus,
} from "@movo/shared";
import { NotificationsClient } from "../../adapters/notifications-client";
import { PaymentsClient } from "../../adapters/payments-client";
import { InvalidShipmentTransitionError } from "../../domain/shipment-state-machine";
import { ShipmentConcurrentModificationError, ShipmentRepository } from "../../repositories/shipment-repository";
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

export interface SettlementServiceDeps {
  repository: ShipmentRepository;
  paymentsClient: PaymentsClient;
  notificationsClient?: NotificationsClient;
  logger?: SettlementLogger;
  /** Dedupe de los pushes entre réplicas (Redis `SET NX`), mismo molde que la saga de MOVO-210. */
  claimNotificationOnce?: (key: string, ttlSeconds: number) => Promise<boolean>;
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
  const { repository, paymentsClient, notificationsClient, logger, claimNotificationOnce } = deps;

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
     * de un envío no frena a los demás.
     */
    async retryPendingSettlements(options: { graceMinutes: number; batchSize: number }): Promise<void> {
      const now = (deps.now ?? (() => new Date()))();
      const deliveredBefore = new Date(now.getTime() - options.graceMinutes * 60 * 1000);
      const pending = await repository.listDeliveredAwaitingSettlement(deliveredBefore, options.batchSize);
      for (const shipment of pending) {
        try {
          await this.captureAndComplete(shipment.id);
        } catch (err) {
          const code = err instanceof ApiError ? err.code : undefined;
          // Un `delivered` sin hold (asignado antes de la saga de pagos) no tiene nada que
          // capturar: se deja registrado y se sigue, no es un fallo de cobro.
          logger?.warn(
            { event: "settlement_retry_failed", shipmentId: shipment.id, code, err },
            code === "HOLD_NOT_FOUND"
              ? "envío entregado sin hold: no hay nada que capturar"
              : "no se pudo capturar el pago del envío entregado, queda para el próximo barrido"
          );
        }
      }
    },
  };
}

export type SettlementService = ReturnType<typeof createSettlementService>;
