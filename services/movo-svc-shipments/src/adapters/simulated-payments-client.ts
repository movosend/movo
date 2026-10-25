import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  ApiError,
  ShipmentStatus,
  type HoldDetailResponse,
  type SettlementResponse,
  type UserLedgerEntry,
} from "@movo/shared";
import {
  createShipmentRepository,
  type PaymentSimulation,
} from "../repositories/shipment-repository";
import { createPaymentsClient, PaymentsClient } from "./payments-client";

/**
 * DD-055 (pago simulado): un admin puede pasar un envío a `assigned` sin hold real y el envío queda marcado
 * (`shipments.payment_simulated`, escrito en el mismo UPDATE que el estado). Mientras dura esa asignación, payments
 * no sabe nada del envío, así que cada llamada sobre él se contesta acá, sin red: un hold `authorized` sintético,
 * una liquidación `credited` en $0 solo una vez entregado, y nada que liberar. El resto de las llamadas (cuenta de
 * MP, deuda, vista previa) no son de un envío y van tal cual.
 *
 * La simulación es de la ASIGNACIÓN, no del envío: solo rige en los estados con transportista asignado (o ya
 * cerrados). Si el envío vuelve a `published` deja de contestarse lo sintético, y la próxima asignación fija la marca
 * de nuevo (`UpdateStatusOptions.paymentSimulated`). Nada se desmarca al liberar el hold: así una cancelación o una
 * baja que pierde una carrera contra el retiro no deja el envío sin marca (y capturando contra el payments real).
 *
 * Los ids sintéticos son el id del envío (estables entre llamadas). Un `holdId` que no es ese es un hold REAL (el
 * emisor pagó a la vez que el admin simulaba): se deja pasar a payments para poder liberarlo. Nunca mueve plata.
 */
export type FindPaymentSimulation = (
  shipmentId: string,
) => Promise<PaymentSimulation | null>;

/** Estados con transportista asignado (o cerrados tras haberlo tenido) en los que rige la simulación. */
const SIMULATION_ACTIVE_STATUSES: ReadonlySet<ShipmentStatus> = new Set([
  ShipmentStatus.ASSIGNED,
  ShipmentStatus.IN_TRANSIT,
  ShipmentStatus.DELIVERED,
  ShipmentStatus.COMPLETED,
  ShipmentStatus.DISPUTED,
  ShipmentStatus.CANCELLED,
]);

/** Estados en los que ya hubo entrega: solo desde ahí existe una liquidación (la real también devuelve null antes). */
const SETTLEMENT_STATUSES: ReadonlySet<ShipmentStatus> = new Set([
  ShipmentStatus.DELIVERED,
  ShipmentStatus.COMPLETED,
]);

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
  find: FindPaymentSimulation,
): PaymentsClient {
  /** El envío con la simulación vigente, o `null` si las llamadas tienen que ir a payments. */
  async function active(
    shipmentId: string,
  ): Promise<{ carrierId: string; status: ShipmentStatus } | null> {
    const simulation = await find(shipmentId);
    if (
      !simulation?.simulated ||
      !SIMULATION_ACTIVE_STATUSES.has(simulation.status)
    )
      return null;
    if (!simulation.carrierId) {
      throw new ApiError(
        409,
        "STATUS_CHANGED",
        "El envío con el pago simulado no tiene transportista asignado: cambió mientras se procesaba.",
      );
    }
    return { carrierId: simulation.carrierId, status: simulation.status };
  }

  return {
    ...inner,

    async findHoldByShipment(shipmentId, options) {
      const simulated = await active(shipmentId);
      if (simulated) return simulatedHold(shipmentId, simulated.carrierId);
      return inner.findHoldByShipment(shipmentId, options);
    },

    async releaseHold(shipmentId, expectedCarrierId, expectedHoldId) {
      // Un hold real (el emisor pagó a la vez) se libera en payments; solo lo sintético se contesta acá.
      if (expectedHoldId !== undefined && expectedHoldId !== shipmentId) {
        return inner.releaseHold(shipmentId, expectedCarrierId, expectedHoldId);
      }
      const simulated = await active(shipmentId);
      if (simulated)
        return {
          ...simulatedHold(
            shipmentId,
            expectedCarrierId ?? simulated.carrierId,
          ),
          status: "cancelled",
        };
      return inner.releaseHold(shipmentId, expectedCarrierId, expectedHoldId);
    },

    async captureHold(shipmentId, request) {
      const simulated = await active(shipmentId);
      if (simulated)
        return {
          ...simulatedSettlement(shipmentId, simulated.carrierId),
          kind: request?.kind ?? "delivery",
        };
      return inner.captureHold(shipmentId, request);
    },

    async findSettlement(shipmentId) {
      const simulated = await active(shipmentId);
      if (simulated) {
        // Como la real: sin liquidación hasta que el envío se entregó.
        return SETTLEMENT_STATUSES.has(simulated.status)
          ? simulatedSettlement(shipmentId, simulated.carrierId)
          : null;
      }
      return inner.findSettlement(shipmentId);
    },

    async createLedgerEntry(userId, entry) {
      // Por la marca cruda, sin mirar el estado: la penalidad de una baja se registra cuando el envío ya volvió a
      // `published`, y igual es de una asignación que nunca se pagó.
      if (entry.shipmentId && (await find(entry.shipmentId))?.simulated) {
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
  return withSimulatedPayments(createPaymentsClient(app.config), (shipmentId) =>
    repository.findPaymentSimulation(shipmentId),
  );
}
