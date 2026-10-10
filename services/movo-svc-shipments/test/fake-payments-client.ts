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
} from "@movo/shared";
import { PaymentsClient } from "../src/adapters/payments-client";

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
}

export interface FakePaymentsClient extends PaymentsClient {
  behavior: FakePaymentsBehavior;
  holds: Map<string, HoldResponse>;
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
    ...behaviorOverrides,
  };
  let sequence = 0;

  const client: FakePaymentsClient = {
    behavior,
    holds,

    getCarrierMpAccountStatus: vi.fn(
      async (userId: string): Promise<CarrierMpAccountStatusResponse> => ({ linked: !unlinked.has(userId) }),
    ),

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
  };

  return client;
}
