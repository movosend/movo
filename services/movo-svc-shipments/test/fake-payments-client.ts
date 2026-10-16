import { randomUUID } from "node:crypto";
import { vi } from "vitest";
import {
  ApiError,
  CLOSED_HOLD_STATUSES,
  CarrierMpAccountStatusResponse,
  HoldFailureReason,
  HoldResponse,
  HoldStatus,
  LIVE_HOLD_STATUSES,
  SettlementResponse,
} from "@movo/shared";
import { PaymentsClient, UserDebtStatus } from "../src/adapters/payments-client";

/**
 * Fake en memoria de `PaymentsClient` -- evita depender de un `movo-svc-payments` real levantado.
 *
 * - MOVO-116: por default todo transportista tiene la cuenta de MP vinculada (así los fixtures
 *   existentes siguen pasando el bloqueo de ADR-036); `unlinkedUserIds` marca los que no.
 * - MOVO-210: reproduce el contrato de los endpoints internos de holds que importan a la saga --
 *   un hold vivo se devuelve tal cual (idempotencia por envío), un rechazo vuelve como
 *   `status: rejected` y no como error, liberar es idempotente. `behavior` se muta desde el test
 *   para simular a MP.
 */
export interface FakePaymentsBehavior {
  /** Estado con que nace el próximo hold. */
  nextHoldStatus: HoldStatus;
  nextFailureReason: HoldFailureReason | null;
  /** Si no es null, `releaseHold` lanza este error. */
  releaseError: ApiError | null;
  /** Si es true, `findHoldByShipment` lanza (payments caído). */
  lookupFails: boolean;
  /** Si es true, `createHold` lanza 502 (MP no respondió). */
  createFails: boolean;
  /** MOVO-212: si no es null, `captureHold` lanza este error (la captura falló). */
  captureError: ApiError | null;
  /**
   * MOVO-313: usuarios con una deuda vencida en la cuenta corriente. Es un `Set` que el test
   * muta (`add`/`delete`) para probar que el bloqueo se levanta en la siguiente consulta, sin cache.
   */
  overdueDebtUserIds: Set<string>;
}

export interface FakePaymentsClient extends PaymentsClient {
  behavior: FakePaymentsBehavior;
  holds: Map<string, HoldResponse>;
  /** MOVO-212: liquidaciones por envío, las crea `captureHold`. */
  settlements: Map<string, SettlementResponse>;
}

export function createFakePaymentsClient(
  unlinkedUserIds: string[] = [],
  overrides: Partial<PaymentsClient> = {},
  behaviorOverrides: Partial<FakePaymentsBehavior> = {},
): FakePaymentsClient {
  const unlinked = new Set(unlinkedUserIds);
  const holds = new Map<string, HoldResponse>();
  const behavior: FakePaymentsBehavior = {
    nextHoldStatus: "authorized",
    nextFailureReason: null,
    releaseError: null,
    lookupFails: false,
    createFails: false,
    captureError: null,
    overdueDebtUserIds: new Set<string>(),
    ...behaviorOverrides,
  };
  const settlements = new Map<string, SettlementResponse>();
  let sequence = 0;

  const client: FakePaymentsClient = {
    behavior,
    holds,
    settlements,

    getCarrierMpAccountStatus: vi.fn(
      async (userId: string): Promise<CarrierMpAccountStatusResponse> => ({ linked: !unlinked.has(userId) }),
    ),

    // MOVO-313: sin deuda por default (así los fixtures existentes siguen pasando el gate). La
    // regla de antigüedad vive en `domain/user-debt.ts` y se prueba aparte; acá solo se dice si
    // el usuario la tiene vencida hoy.
    getUserDebtStatus: vi.fn(async (userId: string): Promise<UserDebtStatus> => {
      if (behavior.overdueDebtUserIds.has(userId)) {
        return {
          overdue: true,
          balanceArs: 4200,
          oldestUnpaidAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
        };
      }
      return { overdue: false, balanceArs: 0, oldestUnpaidAt: null };
    }),

    getCheckoutData: vi.fn(async (input) => ({
      shipmentId: input.shipmentId,
      publicKey: "TEST-carrier-public-key",
      amountArs: input.amountArs,
      applicationFeeArs: Math.round(input.amountArs * 0.13 * 100) / 100,
      payerEmail: input.payerEmail,
    })),

    createHold: vi.fn(async (input) => {
      if (behavior.createFails) {
        throw new ApiError(502, "PAYMENT_PROVIDER_ERROR", "MP no respondió");
      }
      const existing = holds.get(input.shipmentId);
      if (existing && LIVE_HOLD_STATUSES.includes(existing.status)) {
        return existing;
      }
      sequence += 1;
      const now = new Date().toISOString();
      const hold: HoldResponse = {
        // UUID real: el dedupe de avisos por hold vive en Redis entre corridas de tests.
        id: randomUUID(),
        shipmentId: input.shipmentId,
        carrierId: input.carrierId,
        attempt: sequence,
        mpPaymentId: behavior.nextHoldStatus === "rejected" ? null : `mp-${sequence}`,
        collectorId: "collector-1",
        amountArs: input.amountArs,
        applicationFeeArs: Math.round(input.amountArs * 0.13 * 100) / 100,
        status: behavior.nextHoldStatus,
        statusDetail: null,
        failureReason: behavior.nextHoldStatus === "rejected" ? (behavior.nextFailureReason ?? "card_rejected") : null,
        expiresAt: null,
        createdAt: now,
        updatedAt: now,
      };
      holds.set(input.shipmentId, hold);
      return hold;
    }),

    findHoldByShipment: vi.fn(async (shipmentId: string) => {
      if (behavior.lookupFails) {
        throw new ApiError(502, "PAYMENTS_SERVICE_UNAVAILABLE", "payments caído");
      }
      return holds.get(shipmentId) ?? null;
    }),

    releaseHold: vi.fn(async (shipmentId: string) => {
      if (behavior.releaseError) {
        throw behavior.releaseError;
      }
      const hold = holds.get(shipmentId);
      if (!hold) {
        return null;
      }
      if (CLOSED_HOLD_STATUSES.includes(hold.status)) {
        return hold;
      }
      const released: HoldResponse = { ...hold, status: "cancelled" };
      holds.set(shipmentId, released);
      return released;
    }),

    ...overrides,

    // MOVO-212: idempotente como el real -- una liquidación ya acreditada vuelve tal cual.
    captureHold: vi.fn(async (shipmentId: string) => {
      if (behavior.captureError) {
        throw behavior.captureError;
      }
      const existing = settlements.get(shipmentId);
      if (existing) {
        return existing;
      }
      const hold = holds.get(shipmentId);
      if (!hold) {
        throw new ApiError(404, "HOLD_NOT_FOUND", "El envío no tiene ningún hold");
      }
      if (hold.status !== "authorized" && hold.status !== "captured") {
        throw new ApiError(409, "HOLD_NOT_CAPTURABLE", "El hold no se puede capturar");
      }
      const now = new Date().toISOString();
      // 1000 = 41 (MP) + 150 (Movo) + 809 (neto): la misma forma que el sandbox.
      const mpFeeArs = Math.round(hold.amountArs * 0.041 * 100) / 100;
      const settlement: SettlementResponse = {
        id: `00000000-0000-4000-8000-${String(++sequence).padStart(12, "9")}`,
        shipmentId,
        holdId: hold.id,
        carrierId: hold.carrierId,
        mpPaymentId: hold.mpPaymentId ?? "mp-0",
        status: "credited",
        kind: "delivery",
        grossAmountArs: hold.amountArs,
        mpFeeArs,
        commissionArs: hold.applicationFeeArs,
        netAmountArs: Math.round((hold.amountArs - mpFeeArs - hold.applicationFeeArs) * 100) / 100,
        failureReason: null,
        capturedAt: now,
        createdAt: now,
        updatedAt: now,
      };
      settlements.set(shipmentId, settlement);
      holds.set(shipmentId, { ...hold, status: "captured" });
      return settlement;
    }),

    findSettlement: vi.fn(async (shipmentId: string) => settlements.get(shipmentId) ?? null),
  };

  return client;
}
