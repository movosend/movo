import { describe, it, expect } from "vitest";
import type { PaymentSnapshot } from "../src/adapters/mercadopago-client";
import { readFeeBreakdown } from "../src/modules/settlements/capture.service";
import { Prisma } from "../src/generated/prisma/client";
import { missingFeeField, mpFeeFromPayment } from "../src/utils/payment-fee";

const charge = (original: number, extra: Record<string, unknown> = {}) => ({
  name: "mercadopago_fee",
  accounts: { from: "collector", to: "mp" },
  amounts: { original, refunded: 0 },
  ...extra,
});

describe("mpFeeFromPayment (MOVO-285)", () => {
  it("antes de capturar toma el mercadopago_fee de charges_details", () => {
    expect(mpFeeFromPayment({ charges_details: [charge(47.15)] })).toEqual({ mpFeeArs: 47.15 });
  });

  it("no resta lo devuelto: un hold liberado no pisa el fee real con 0", () => {
    const released = { charges_details: [charge(47.15, { amounts: { original: 47.15, refunded: 47.15 } })] };
    expect(mpFeeFromPayment(released)).toEqual({ mpFeeArs: 47.15 });
  });

  it("descarta un cargo del pagador, un monto inválido o la falta de desglose", () => {
    expect(mpFeeFromPayment({})).toEqual({});
    expect(mpFeeFromPayment({ charges_details: [] })).toEqual({});
    expect(mpFeeFromPayment({ charges_details: [charge(41, { accounts: { from: "payer" } })] })).toEqual({});
    expect(mpFeeFromPayment({ charges_details: [charge(-1)] })).toEqual({});
    expect(mpFeeFromPayment({ charges_details: [charge(10.123)] })).toEqual({});
  });

  it("misma regla que la liquidación: todo cargo del vendedor salvo el application_fee es fee de MP", () => {
    const payment: PaymentSnapshot = {
      transaction_details: { net_received_amount: 800 },
      fee_details: [
        { type: "mercadopago_fee", amount: 41, fee_payer: "collector" },
        { type: "other_collector_fee", amount: 4.5, fee_payer: "collector" },
        { type: "application_fee", amount: 150, fee_payer: "collector" },
        { type: "financing_fee", amount: 9, fee_payer: "payer" },
      ],
    };
    const settlementFee = readFeeBreakdown(payment, new Prisma.Decimal(150))!.mpFeeArs.toNumber();
    expect(mpFeeFromPayment(payment)).toEqual({ mpFeeArs: settlementFee });
    expect(settlementFee).toBe(45.5);
  });

  it("con un monto sin informar en fee_details no inventa un valor", () => {
    expect(mpFeeFromPayment({ fee_details: [{ type: "mercadopago_fee" }] })).toEqual({});
  });
});

describe("missingFeeField (MOVO-285)", () => {
  const withFee: PaymentSnapshot = { charges_details: [charge(47.15)] };

  it("completa solo cuando el hold no tenía fee", () => {
    expect(missingFeeField({ mpFeeArs: null }, withFee)).toEqual({ mpFeeArs: 47.15 });
    expect(missingFeeField({}, withFee)).toEqual({ mpFeeArs: 47.15 });
    expect(missingFeeField({ mpFeeArs: new Prisma.Decimal(40) }, withFee)).toEqual({});
  });
});
