import { describe, expect, it, vi } from "vitest";
import { createTransactionsService } from "../src/modules/transactions/transactions.service";
import type { TransactionRepository, TransactionRow } from "../src/repositories/transaction-repository";

const row: TransactionRow = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", kind: "shipment",
  shipmentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", mpPaymentId: "mp-1",
  createdAt: new Date("2026-10-18T12:00:00Z"), createdAtCursor: "2026-10-18T12:00:00.000000Z",
  amountArs: 1400, baseAmountArs: 1150, holdStatus: "captured",
  cardBrand: null, cardLast4: null, cardAlias: null, cardIssuerName: null, cardPaymentType: null,
  releasedAt: null, holdStatusDetail: null, settlementStatus: "credited", capturedAt: new Date("2026-10-18T12:01:00Z"),
  grossAmountArs: 1400, mpFeeArs: 50, commissionArs: 150, debtOffsetArs: 0,
  debtSurchargeArs: 249.99, carrierGrossAmountArs: 1150, carrierMpFeeArs: 50, netAmountArs: 950,
  hasDispute: false, hasRefund: false, refundedAmountArs: null,
};

async function senderDebt(overrides: Partial<TransactionRow>) {
  const transactions = { list: vi.fn().mockResolvedValue([{ ...row, ...overrides }]) } as unknown as TransactionRepository;
  const page = await createTransactionsService({ transactions }).list("user-1", { role: "sender" });
  return page.items[0].debtAmountArs;
}

describe("deuda del emisor en Historial", () => {
  it("usa el recargo registrado, incluso si difiere de monto menos precio", async () => {
    expect(await senderDebt({})).toBe(249.99);
  });

  it("omite la deuda en reservas liberadas, reembolsadas o disputadas", async () => {
    expect(await senderDebt({ holdStatus: "cancelled", settlementStatus: null })).toBeNull();
    expect(await senderDebt({ hasRefund: true })).toBeNull();
    expect(await senderDebt({ hasDispute: true })).toBeNull();
  });
});
