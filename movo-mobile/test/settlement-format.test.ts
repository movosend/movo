import type { ShipmentSettlementResponse } from "@movo/shared/dist/types/settlement";
import {
  formatSettlementAmount,
  formatSettlementDateTime,
  resolvePaymentView,
} from "../src/lib/settlement-format";

function settlement(overrides: Partial<ShipmentSettlementResponse> = {}): ShipmentSettlementResponse {
  return {
    shipmentId: "shipment-1",
    role: "carrier",
    kind: "delivery",
    status: "credited",
    paidAmountArs: 13800,
    debtCollectedArs: 0,
    paidAt: "2026-10-14T19:42:00.000Z",
    mpFeeArs: 688.62,
    commissionArs: 1800,
    netAmountArs: 11311.38,
    ...overrides,
  };
}

describe("resolvePaymentView (MOVO-214)", () => {
  it("transportista con la liquidación acreditada: desglose completo y fecha", () => {
    expect(resolvePaymentView("carrier", settlement(), 13800)).toEqual({
      kind: "carrier_credited",
      grossArs: 13800,
      commissionArs: 1800,
      mpFeeArs: 688.62,
      netArs: 11311.38,
      creditedAt: "2026-10-14T19:42:00.000Z",
    });
  });

  it("sin liquidación (404) el transportista ve 'en proceso' con el precio pactado", () => {
    expect(resolvePaymentView("carrier", null, 13800)).toEqual({ kind: "carrier_processing", amountArs: 13800 });
  });

  it("nunca muestra como acreditado un neto que no llegó (AC4)", () => {
    expect(resolvePaymentView("carrier", settlement({ status: "processing" }), null).kind).toBe("carrier_processing");
    expect(resolvePaymentView("carrier", settlement({ netAmountArs: null }), null).kind).toBe("carrier_processing");
    expect(resolvePaymentView("carrier", settlement({ mpFeeArs: null }), null).kind).toBe("carrier_processing");
  });

  it("transportista con la liquidación escalada", () => {
    expect(resolvePaymentView("carrier", settlement({ status: "escalated", netAmountArs: null }), null)).toEqual({
      kind: "carrier_escalated",
      amountArs: 13800,
    });
  });

  it("emisor: total y fecha cuando se acreditó, 'en proceso' en cualquier otro caso", () => {
    const sender = { shipmentId: "shipment-1", role: "sender" as const, kind: "delivery" as const, paidAmountArs: 13800, debtCollectedArs: 0, paidAt: null };
    expect(resolvePaymentView("sender", { ...sender, status: "credited", paidAt: "2026-10-14T19:42:00.000Z" }, null)).toEqual({
      kind: "sender_paid",
      amountArs: 13800,
      paidAt: "2026-10-14T19:42:00.000Z",
    });
    expect(resolvePaymentView("sender", { ...sender, status: "escalated" }, null).kind).toBe("sender_processing");
    expect(resolvePaymentView("sender", null, 9000)).toEqual({ kind: "sender_processing", amountArs: 9000 });
  });
});

describe("formatSettlementAmount", () => {
  it("muestra centavos solo cuando los hay", () => {
    expect(formatSettlementAmount(13800)).toBe("$13.800");
    expect(formatSettlementAmount(11311.38)).toBe("$11.311,38");
    expect(formatSettlementAmount(688.6)).toBe("$688,60");
  });
});

describe("formatSettlementDateTime", () => {
  it("arma día, mes y hora sin puntos de abreviatura", () => {
    expect(formatSettlementDateTime("2026-10-14T19:42:00.000Z")).toMatch(/^\p{L}+ \d{1,2} \p{L}+, \d{2}:\d{2} h$/u);
  });

  it("devuelve null ante una fecha inválida", () => {
    expect(formatSettlementDateTime("no-es-fecha")).toBeNull();
  });
});
