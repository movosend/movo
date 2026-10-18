import { describe, expect, it, vi } from "vitest";
import { Prisma } from "../src/generated/prisma/client";
import { createUserLedgerService } from "../src/modules/user-ledger/user-ledger.service";
import type { UserLedgerRepository } from "../src/repositories/user-ledger-repository";
import type { PrismaClient } from "../src/generated/prisma/client";
import type { ShipmentsClient } from "../src/adapters/shipments-client";

const userId = "11111111-1111-4111-8111-111111111111";
const shipmentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function service(resolveLedgerOrigins: ShipmentsClient["resolveLedgerOrigins"]) {
  const base = { userId, roleAtOrigin: "carrier", amountArs: new Prisma.Decimal(50),
    status: "settled", holdId: null, reason: null, createdAt: new Date("2026-01-01"),
    idempotencyKey: "test", requestFingerprint: "test", adminId: null };
  const ledger = { summaryWithPage: vi.fn().mockResolvedValue({
    balance: new Prisma.Decimal(0), oldestUnpaidAt: null, rows: [
      { ...base, id: shipmentId, type: "cancellation_penalty", shipmentId, paymentId: null },
      { ...base, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", type: "voluntary_payment",
        shipmentId: null, paymentId: "mp-1" },
    ],
  }) } as unknown as UserLedgerRepository;
  const db = {
    balancePaymentAttempt: { findMany: vi.fn().mockResolvedValue([{
      mpPaymentId: "mp-1", savedCardId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    }]) },
    savedCard: { findMany: vi.fn().mockResolvedValue([{
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", brand: "visa", last4: "1234",
    }]) },
  } as unknown as PrismaClient;
  const shipmentsClient = { resolveLedgerOrigins } as ShipmentsClient;
  return createUserLedgerService({ ledger, db, shipmentsClient });
}

describe("saldo con orígenes", () => {
  it("combina envío y tarjeta", async () => {
    const result = await service(async () => [{ id: shipmentId, label: "Envío a Córdoba", destination: "Córdoba" }])
      .pageWithOrigins(userId, {});
    expect(result.items.map((item) => item.originLabel)).toEqual(["Envío a Córdoba", "Visa •••• 1234"]);
    expect(result.items.map((item) => item.destination)).toEqual(["Córdoba", null]);
  });

  it("conserva el saldo y la tarjeta si shipments falla", async () => {
    const result = await service(async () => { throw new Error("caído"); }).pageWithOrigins(userId, {});
    expect(result.items.map((item) => item.originLabel)).toEqual([null, "Visa •••• 1234"]);
  });
});
