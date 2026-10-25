import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type {
  HoldDetailResponse,
  SettlementResponse,
  UserLedgerEntry,
} from "@movo/shared";
import { createShipmentRepository } from "../repositories/shipment-repository";
import { createPaymentsClient, PaymentsClient } from "./payments-client";

/**
 * DD-055 (pago simulado): un admin puede pasar un envío a `assigned` sin hold real y el envío queda marcado
 * (`shipments.payment_simulated`). Desde ahí payments no sabe nada de él, así que cada llamada sobre ese envío se
 * contesta acá, sin red: un hold `authorized` sintético, una liquidación `credited` en $0 y nada que liberar. El
 * resto de las llamadas (cuenta de MP, deuda, vista previa) no son de un envío y van tal cual.
 *
 * Los ids sintéticos son el id del envío (estables entre llamadas). Nunca mueve plata: ni el emisor paga ni el transportista cobra, y no se escribe en la cuenta corriente.
 */
export type IsPaymentSimulated = (shipmentId: string) => Promise<boolean>;
export type ClearPaymentSimulated = (shipmentId: string) => Promise<void>;

function simulatedHold(
  shipmentId: string,
  carrierId: string,
): HoldDetailResponse {
  const now = new Date().toISOString();
  return {
    id: shipmentId,
    shipmentId,
    carrierId,
    attempt: 1,
    mpPaymentId: null,
    collectorId: "simulated",
    amountArs: 0,
    applicationFeeArs: 0,
    commissionArs: 0,
    carrierMpFeeArs: null,
    baseAmountArs: 0,
    debtOffsetArs: 0,
    debtSurchargeArs: 0,
    status: "authorized",
    statusDetail: "simulated",
    failureReason: null,
    expiresAt: null,
    createdAt: now,
    updatedAt: now,
    wasAuthorized: true,
    cardBrand: null,
    cardLast4: null,
  };
}

function simulatedSettlement(
  shipmentId: string,
  carrierId: string,
): SettlementResponse {
  const now = new Date().toISOString();
  return {
    id: shipmentId,
    shipmentId,
    holdId: shipmentId,
    carrierId,
    mpPaymentId: "simulated",
    status: "credited",
    kind: "delivery",
    grossAmountArs: 0,
    mpFeeArs: 0,
    commissionArs: 0,
    debtOffsetArs: 0,
    debtSurchargeArs: 0,
    carrierGrossAmountArs: 0,
    carrierMpFeeArs: 0,
    netAmountArs: 0,
    failureReason: null,
    capturedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

export function withSimulatedPayments(
  inner: PaymentsClient,
  isSimulated: IsPaymentSimulated,
  /** Quién es el transportista del envío: el hold y la liquidación sintéticos lo llevan. */
  carrierOf: (shipmentId: string) => Promise<string>,
  /** Se llama al liberar: el envío vuelve a cobrarse de verdad si se reasigna (baja del transportista, cancelación). */
  clear: ClearPaymentSimulated,
): PaymentsClient {
  return {
    ...inner,

    async findHoldByShipment(shipmentId, options) {
      if (await isSimulated(shipmentId))
        return simulatedHold(shipmentId, await carrierOf(shipmentId));
      return inner.findHoldByShipment(shipmentId, options);
    },

    async releaseHold(shipmentId, expectedCarrierId, expectedHoldId) {
      // No hay nada que liberar en MP: se devuelve el hold sintético como cancelado. Se desmarca el envío, o el
      // próximo emisor de un envío vuelto a publicar vería un hold `authorized` que nunca pagó.
      if (await isSimulated(shipmentId)) {
        const carrierId = expectedCarrierId ?? (await carrierOf(shipmentId));
        await clear(shipmentId);
        return {
          ...simulatedHold(shipmentId, carrierId),
          status: "cancelled",
        };
      }
      return inner.releaseHold(shipmentId, expectedCarrierId, expectedHoldId);
    },

    async captureHold(shipmentId, request) {
      if (await isSimulated(shipmentId)) {
        return {
          ...simulatedSettlement(shipmentId, await carrierOf(shipmentId)),
          kind: request?.kind ?? "delivery",
        };
      }
      return inner.captureHold(shipmentId, request);
    },

    async findSettlement(shipmentId) {
      if (await isSimulated(shipmentId))
        return simulatedSettlement(shipmentId, await carrierOf(shipmentId));
      return inner.findSettlement(shipmentId);
    },

    async createLedgerEntry(userId, entry) {
      if (entry.shipmentId && (await isSimulated(entry.shipmentId))) {
        const created: UserLedgerEntry = {
          id: randomUUID(),
          userId,
          roleAtOrigin: entry.roleAtOrigin ?? null,
          type: entry.type,
          amountArs: 0,
          status: "voided",
          shipmentId: entry.shipmentId,
          holdId: null,
          paymentId: null,
          reason: null,
          createdAt: new Date().toISOString(),
        };
        return { entry: created, created: false };
      }
      return inner.createLedgerEntry(userId, entry);
    },
  };
}

/**
 * El cliente de payments que usan las rutas, los barridos y los servicios de `svc-shipments`: el real, con el pago
 * simulado de DD-055 por encima. Va por envío (columna `payment_simulated`), nunca por entorno.
 */
export function createAppPaymentsClient(app: FastifyInstance): PaymentsClient {
  const repository = createShipmentRepository(app.db);
  return withSimulatedPayments(
    createPaymentsClient(app.config),
    (shipmentId) => repository.isPaymentSimulated(shipmentId),
    async (shipmentId) =>
      (await repository.findById(shipmentId))?.carrierId ?? "",
    (shipmentId) => repository.setPaymentSimulated(shipmentId, false),
  );
}
