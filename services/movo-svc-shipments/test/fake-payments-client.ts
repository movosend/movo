import { randomUUID } from "node:crypto";
import { vi } from "vitest";
import {
  ApiError,
  CLOSED_HOLD_STATUSES,
  CaptureHoldRequest,
  CarrierMpAccountStatusResponse,
  CreateManualAdjustmentRequest,
  CreateRefundRequest,
  CreateUserLedgerEntryRequest,
  HoldFailureReason,
  HoldDetailResponse,
  HoldStatus,
  LIVE_HOLD_STATUSES,
  RefundResponse,
  RefundStatus,
  SettlementResponse,
  UserLedgerEntry,
  cashPenaltyCompensationArs,
  decomposeOfferGrossPrice,
  estimateMpFeeArs,
} from "@movo/shared";
import { PaymentsClient, UserDebtStatus } from "../src/adapters/payments-client";

/**
 * Fake en memoria de `PaymentsClient` -- evita depender de un `movo-svc-payments` real levantado.
 *
 * - MOVO-116: por default todo transportista tiene la cuenta de MP vinculada (así los fixtures
 *   existentes siguen pasando el bloqueo de DD-036); `unlinkedUserIds` marca los que no.
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
  /**
   * MOVO-311: deuda pendiente (ARS) por usuario. El fake la cobra con el tope del 30% por envío, igual
   * que payments: al transportista en el "Recibís aprox." y al emisor como recargo del pago.
   */
  pendingDebtByUserId: Map<string, number>;
  /** MOVO-311: si es true, `previewCarrierDebt` devuelve `null` (payments caído). */
  previewFails: boolean;
  /** MOVO-307: si no es null, `createLedgerEntry` lanza este error (payments caído). MOVO-37: también los
   * registros de envíos en efectivo. */
  ledgerError: ApiError | null;
  /** MOVO-337: si no es null, `createRefund` lanza este error (rechazo de negocio o payments caído). */
  refundError: ApiError | null;
  /** MOVO-337: estado con que termina el próximo reembolso (`fallback_to_ledger` = el transportista no tenía saldo). */
  nextRefundStatus: RefundStatus;
  /** MOVO-337: si no es null, `createManualAdjustment` lanza este error. */
  manualAdjustmentError: ApiError | null;
}

const DEBT_CAP_RATE = 0.3;
const debtOffset = (debt: number | undefined, priceArs: number): number =>
  Math.min(Math.max(0, debt ?? 0), Math.floor(priceArs * DEBT_CAP_RATE * 100) / 100);

export interface FakePaymentsClient extends PaymentsClient {
  behavior: FakePaymentsBehavior;
  holds: Map<string, HoldDetailResponse>;
  /** MOVO-212: liquidaciones por envío, las crea `captureHold`. */
  settlements: Map<string, SettlementResponse>;
  /** MOVO-307: movimientos de la cuenta corriente por `idempotencyKey`. */
  ledgerEntries: Map<string, UserLedgerEntry>;
  /** MOVO-337: reembolsos por `idempotencyKey`. */
  refunds: Map<string, RefundResponse>;
  /** MOVO-337: ajustes manuales de la cuenta corriente por `idempotencyKey`. */
  manualAdjustments: Map<string, UserLedgerEntry>;
}

export function createFakePaymentsClient(
  unlinkedUserIds: string[] = [],
  overrides: Partial<PaymentsClient> = {},
  behaviorOverrides: Partial<FakePaymentsBehavior> = {},
): FakePaymentsClient {
  const unlinked = new Set(unlinkedUserIds);
  const holds = new Map<string, HoldDetailResponse>();
  const behavior: FakePaymentsBehavior = {
    nextHoldStatus: "authorized",
    nextFailureReason: null,
    releaseError: null,
    lookupFails: false,
    createFails: false,
    captureError: null,
    overdueDebtUserIds: new Set<string>(),
    pendingDebtByUserId: new Map<string, number>(),
    previewFails: false,
    ledgerError: null,
    refundError: null,
    nextRefundStatus: "succeeded",
    manualAdjustmentError: null,
    ...behaviorOverrides,
  };
  const settlements = new Map<string, SettlementResponse>();
  const ledgerEntries = new Map<string, UserLedgerEntry>();
  const refunds = new Map<string, RefundResponse>();
  const manualAdjustments = new Map<string, UserLedgerEntry>();
  let sequence = 0;

  /** Lo reembolsable: lo capturado menos los intentos que cuentan (todos menos `failed`), como el real. */
  const refundableOf = (shipmentId: string): number => {
    const settlement = settlements.get(shipmentId);
    if (!settlement) return 0;
    const counted = [...refunds.values()]
      .filter((refund) => refund.shipmentId === shipmentId && refund.status !== "failed")
      .reduce((sum, refund) => sum + refund.amountArs, 0);
    return Math.round((settlement.grossAmountArs - counted) * 100) / 100;
  };

  const client: FakePaymentsClient = {
    behavior,
    holds,
    settlements,
    ledgerEntries,
    refunds,
    manualAdjustments,

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
      // MOVO-37: la deuda pendiente (no vencida) también cuenta para el saldo: la miran los gates de efectivo.
      const pending = behavior.pendingDebtByUserId.get(userId) ?? 0;
      return {
        overdue: false,
        balanceArs: pending,
        oldestUnpaidAt: pending > 0 ? new Date().toISOString() : null,
      };
    }),

    previewCarrierDebt: vi.fn(async (userId: string, amountsArs: number[]) => {
      if (behavior.previewFails) return null;
      const debt = behavior.pendingDebtByUserId.get(userId) ?? 0;
      return {
        pendingBalanceArs: Math.max(0, debt),
        debtOffsetsArs: amountsArs.map((price) => debtOffset(debt, price)),
      };
    }),

    getCheckoutData: vi.fn(async (input) => {
      const surcharge = input.payerUserId
        ? debtOffset(behavior.pendingDebtByUserId.get(input.payerUserId), input.amountArs)
        : 0;
      const offset = debtOffset(behavior.pendingDebtByUserId.get(input.carrierId), input.amountArs);
      return {
        shipmentId: input.shipmentId,
        publicKey: "TEST-carrier-public-key",
        amountArs: input.amountArs + surcharge,
        applicationFeeArs: Math.round((input.amountArs * 0.13 + offset + surcharge) * 100) / 100,
        baseAmountArs: input.amountArs,
        debtOffsetArs: offset,
        debtSurchargeArs: surcharge,
        payerEmail: input.payerEmail,
      };
    }),

    createHold: vi.fn(async (input) => {
      if (behavior.createFails) {
        throw new ApiError(502, "PAYMENT_PROVIDER_ERROR", "MP no respondió");
      }
      // MOVO-311: igual que payments, si el total que confirmó el emisor ya no es el que corresponde cobrar, 409.
      if (input.expectedTotalArs !== undefined) {
        const total = input.amountArs + debtOffset(behavior.pendingDebtByUserId.get(input.payerUserId), input.amountArs);
        if (Math.abs(total - input.expectedTotalArs) > 0.001) {
          throw new ApiError(409, "HOLD_AMOUNT_CHANGED", "El monto a pagar cambió", { totalArs: total });
        }
      }
      const existing = holds.get(input.shipmentId);
      if (existing && LIVE_HOLD_STATUSES.includes(existing.status)) {
        return existing;
      }
      sequence += 1;
      const now = new Date().toISOString();
      const hold: HoldDetailResponse = {
        // UUID real: el dedupe de avisos por hold vive en Redis entre corridas de tests.
        id: randomUUID(),
        shipmentId: input.shipmentId,
        carrierId: input.carrierId,
        attempt: sequence,
        mpPaymentId: behavior.nextHoldStatus === "rejected" ? null : `mp-${sequence}`,
        collectorId: "collector-1",
        amountArs: input.amountArs,
        applicationFeeArs: Math.round(input.amountArs * 0.13 * 100) / 100,
        baseAmountArs: input.amountArs,
        commissionArs: Math.round(input.amountArs * 0.13 * 100) / 100,
        debtOffsetArs: 0,
        debtSurchargeArs: 0,
        carrierMpFeeArs: null,
        status: behavior.nextHoldStatus,
        wasAuthorized: behavior.nextHoldStatus === "authorized" || behavior.nextHoldStatus === "captured",
        statusDetail: null,
        failureReason: behavior.nextHoldStatus === "rejected" ? (behavior.nextFailureReason ?? "card_rejected") : null,
        cardBrand: "visa",
        cardLast4: "3704",
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

    releaseHold: vi.fn(async (shipmentId: string, expectedCarrierId?: string, expectedHoldId?: string) => {
      if (behavior.releaseError) {
        throw behavior.releaseError;
      }
      const hold = holds.get(shipmentId);
      if (!hold) {
        return null;
      }
      if ((expectedCarrierId && hold.carrierId !== expectedCarrierId) ||
          (expectedHoldId && hold.id !== expectedHoldId)) {
        throw new ApiError(409, "HOLD_CONFLICT", "El hold pertenece a otra asignación");
      }
      if (CLOSED_HOLD_STATUSES.includes(hold.status)) {
        return hold;
      }
      const released: HoldDetailResponse = { ...hold, status: "cancelled" };
      holds.set(shipmentId, released);
      return released;
    }),

    ...overrides,

    // MOVO-212: idempotente como el real -- una liquidación ya acreditada vuelve tal cual.
    // MOVO-306/307: con `kind: cancellation_penalty` captura `amountArs` y aplica las mismas
    // validaciones que payments (monto dentro del hold y mayor que la comisión, que MP cobra
    // entera: spike MOVO-305).
    captureHold: vi.fn(async (shipmentId: string, request?: CaptureHoldRequest) => {
      if (behavior.captureError) {
        throw behavior.captureError;
      }
      const kind = request?.kind ?? "delivery";
      const existing = settlements.get(shipmentId);
      if (existing) {
        if (existing.kind !== kind || (kind === "cancellation_penalty" && existing.grossAmountArs !== request?.amountArs)) {
          throw new ApiError(409, "SETTLEMENT_CONFLICT", "El envío ya tiene otra liquidación");
        }
        return existing;
      }
      const hold = holds.get(shipmentId);
      if (!hold) {
        throw new ApiError(404, "HOLD_NOT_FOUND", "El envío no tiene ningún hold");
      }
      if (hold.status !== "authorized" && hold.status !== "captured") {
        throw new ApiError(409, "HOLD_NOT_CAPTURABLE", "El hold no se puede capturar");
      }
      const grossAmountArs = kind === "cancellation_penalty" ? (request?.amountArs ?? 0) : hold.amountArs;
      if (grossAmountArs > hold.amountArs) {
        throw new ApiError(422, "CAPTURE_AMOUNT_EXCEEDS_HOLD", "La penalidad supera el hold");
      }
      // Mismo piso que payments: tiene que cubrir la comisión y el fee de MP estimado.
      if (grossAmountArs - estimateMpFeeArs(grossAmountArs) <= hold.applicationFeeArs) {
        throw new ApiError(422, "CAPTURE_BELOW_APPLICATION_FEE", "La penalidad no supera la comisión");
      }
      const now = new Date().toISOString();
      // 1000 = 41 (MP) + 150 (Movo) + 809 (neto): la misma forma que el sandbox.
      const mpFeeArs = Math.round(grossAmountArs * 0.041 * 100) / 100;
      const surchargeFee = Math.round((hold.applicationFeeArs - hold.commissionArs - hold.debtOffsetArs) * 100) / 100;
      const settlement: SettlementResponse = {
        id: `00000000-0000-4000-8000-${String(++sequence).padStart(12, "9")}`,
        shipmentId,
        holdId: hold.id,
        carrierId: hold.carrierId,
        mpPaymentId: hold.mpPaymentId ?? "mp-0",
        status: "credited",
        kind,
        grossAmountArs,
        mpFeeArs,
        commissionArs: hold.commissionArs,
        debtOffsetArs: hold.debtOffsetArs,
        debtSurchargeArs: hold.debtSurchargeArs,
        carrierGrossAmountArs: Math.round((grossAmountArs - hold.debtSurchargeArs) * 100) / 100,
        carrierMpFeeArs: Math.round((mpFeeArs - (hold.debtSurchargeArs - surchargeFee)) * 100) / 100,
        netAmountArs: Math.round((grossAmountArs - mpFeeArs - hold.applicationFeeArs) * 100) / 100,
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

    // MOVO-307: idempotente por `idempotencyKey`, como el real.
    createLedgerEntry: vi.fn(async (userId: string, entry: CreateUserLedgerEntryRequest) => {
      if (behavior.ledgerError) {
        throw behavior.ledgerError;
      }
      const existing = ledgerEntries.get(entry.idempotencyKey);
      if (existing) {
        return { entry: existing, created: false };
      }
      const created: UserLedgerEntry = {
        id: randomUUID(),
        userId,
        roleAtOrigin: entry.roleAtOrigin ?? null,
        type: entry.type,
        amountArs: entry.amountArs,
        status: entry.status ?? "pending",
        shipmentId: entry.shipmentId ?? null,
        holdId: entry.holdId ?? null,
        paymentId: entry.paymentId ?? null,
        reason: null,
        createdAt: new Date().toISOString(),
      };
      ledgerEntries.set(entry.idempotencyKey, created);
      return { entry: created, created: true };
    }),

    // MOVO-37: idempotentes por envío (las keys son las de svc-payments), mismo cálculo que el real.
    registerCashCommission: vi.fn(async (shipmentId: string, input) => {
      if (behavior.ledgerError) throw behavior.ledgerError;
      const commissionArs = decomposeOfferGrossPrice(input.agreedPriceArs).commissionAmountArs;
      const { entry, created } = await client.createLedgerEntry(input.carrierId, {
        idempotencyKey: `cash_commission:${shipmentId}`,
        type: "cash_commission",
        roleAtOrigin: "carrier",
        amountArs: commissionArs,
        shipmentId,
      });
      return { commissionArs, entry, created };
    }),

    registerCashCancellationPenalty: vi.fn(async (shipmentId: string, input) => {
      if (behavior.ledgerError) throw behavior.ledgerError;
      const { entry: penaltyEntry, created } = await client.createLedgerEntry(input.senderId, {
        idempotencyKey: `penalty:${shipmentId}`,
        type: "cancellation_penalty",
        roleAtOrigin: "sender",
        amountArs: input.penaltyArs,
        shipmentId,
      });
      const compensationArs = cashPenaltyCompensationArs(input.agreedPriceArs, input.penaltyArs);
      const compensationEntry =
        compensationArs > 0
          ? (
              await client.createLedgerEntry(input.carrierId, {
                idempotencyKey: `penalty_compensation:${shipmentId}`,
                type: "cancellation_compensation",
                roleAtOrigin: "carrier",
                amountArs: -compensationArs,
                status: "settled",
                shipmentId,
              })
            ).entry
          : null;
      return { penaltyEntry, compensationEntry, compensationArs, created };
    }),

    // MOVO-337: idempotente por `idempotencyKey` y con el mismo tope que payments (lo reembolsable).
    createRefund: vi.fn(async (shipmentId: string, request: CreateRefundRequest) => {
      if (behavior.refundError) {
        throw behavior.refundError;
      }
      const replayed = refunds.get(request.idempotencyKey);
      if (replayed) {
        return { refund: replayed, replayed: true };
      }
      const settlement = settlements.get(shipmentId);
      if (!settlement || settlement.status !== "credited") {
        throw new ApiError(409, "SETTLEMENT_NOT_REFUNDABLE", "El envío no tiene un cobro capturado");
      }
      const refundableArs = refundableOf(shipmentId);
      const amountArs = request.amountArs ?? refundableArs;
      if (amountArs > refundableArs) {
        throw new ApiError(422, "REFUND_AMOUNT_EXCEEDS_REFUNDABLE", "El monto supera lo reembolsable", { refundableArs });
      }
      const now = new Date().toISOString();
      const status = behavior.nextRefundStatus;
      const refund: RefundResponse = {
        id: randomUUID(),
        settlementId: settlement.id,
        shipmentId,
        attempt: refunds.size + 1,
        amountArs,
        reason: request.reason,
        status,
        failureReason: status === "failed" ? "provider_rejected" : status === "fallback_to_ledger" ? "insufficient_balance" : null,
        mpRefundId: status === "succeeded" ? `mp-refund-${refunds.size + 1}` : null,
        ledgerEntryId: status === "fallback_to_ledger" ? randomUUID() : null,
        createdAt: now,
        updatedAt: now,
      };
      refunds.set(request.idempotencyKey, refund);
      return { refund, replayed: false };
    }),

    listRefunds: vi.fn(async (shipmentId: string) => {
      if (!settlements.has(shipmentId)) return null;
      return {
        refunds: [...refunds.values()].filter((refund) => refund.shipmentId === shipmentId),
        refundableArs: refundableOf(shipmentId),
      };
    }),

    // MOVO-337: idempotente por `idempotencyKey`.
    createManualAdjustment: vi.fn(async (userId: string, request: CreateManualAdjustmentRequest) => {
      if (behavior.manualAdjustmentError) {
        throw behavior.manualAdjustmentError;
      }
      const existing = manualAdjustments.get(request.idempotencyKey);
      if (existing) {
        return { entry: existing, created: false };
      }
      const created: UserLedgerEntry = {
        id: randomUUID(),
        userId,
        roleAtOrigin: null,
        type: "manual_adjustment",
        amountArs: request.amountArs,
        status: "pending",
        shipmentId: request.shipmentId ?? null,
        holdId: null,
        paymentId: null,
        reason: request.reason,
        createdAt: new Date().toISOString(),
      };
      manualAdjustments.set(request.idempotencyKey, created);
      return { entry: created, created: true };
    }),
  };

  return client;
}
