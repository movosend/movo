import { describe, it, expect } from "vitest";
import { deriveTransactionStatus } from "../src/modules/transactions/transaction-status";

const base = { holdStatus: "authorized", settlementStatus: null, hasDispute: false, hasRefund: false } as const;

describe("deriveTransactionStatus (MOVO-303)", () => {
  it.each(["in_process", "authorized"] as const)("hold %s sin liquidación es reserved", (holdStatus) => {
    expect(deriveTransactionStatus({ ...base, holdStatus })).toBe("reserved");
  });

  it("capturado sin liquidación acreditada sigue reserved", () => {
    expect(deriveTransactionStatus({ ...base, holdStatus: "captured" })).toBe("reserved");
    expect(deriveTransactionStatus({ ...base, holdStatus: "captured", settlementStatus: "processing" })).toBe("reserved");
    expect(deriveTransactionStatus({ ...base, holdStatus: "captured", settlementStatus: "failed" })).toBe("reserved");
  });

  it("completed exige la liquidación credited", () => {
    expect(deriveTransactionStatus({ ...base, holdStatus: "captured", settlementStatus: "credited" })).toBe("completed");
  });

  it("un hold cancelado es released", () => {
    expect(deriveTransactionStatus({ ...base, holdStatus: "cancelled" })).toBe("released");
  });

  it("refunded gana sobre completed y released", () => {
    expect(
      deriveTransactionStatus({ ...base, holdStatus: "captured", settlementStatus: "credited", hasRefund: true })
    ).toBe("refunded");
    expect(deriveTransactionStatus({ ...base, holdStatus: "cancelled", hasRefund: true })).toBe("refunded");
  });

  it("disputed gana sobre todo", () => {
    expect(
      deriveTransactionStatus({
        holdStatus: "captured",
        settlementStatus: "credited",
        hasRefund: true,
        hasDispute: true,
      })
    ).toBe("disputed");
  });
});
