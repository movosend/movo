import { afterEach, describe, expect, it } from "vitest";
import {
  cashPenaltyCompensationArs,
  __resetCommissionConfigForTests,
  carrierPaymentView,
  computeNetFromGross,
  computeOfferGrossPrice,
  decomposeOfferGrossPrice,
  estimateMpFeeArs,
  estimateReceivedArs,
  getCommissionConfig,
  parseRate,
} from "../src/config/commission";

describe("commission", () => {
  afterEach(() => {
    delete process.env.MOVO_COMMISSION_RATE;
    delete process.env.MP_TRANSACTION_FEE_RATE;
    __resetCommissionConfigForTests();
  });

  describe("computeOfferGrossPrice", () => {
    it("suma la comisión (15% default) sobre el neto y redondea a 2 decimales", () => {
      expect(computeOfferGrossPrice(1000)).toEqual({ netArs: 1000, commissionAmountArs: 150, grossArs: 1150 });
    });

    it("acepta una tasa explícita en vez de la vigente en env", () => {
      expect(computeOfferGrossPrice(1000, 0.1)).toEqual({ netArs: 1000, commissionAmountArs: 100, grossArs: 1100 });
    });
  });

  describe("computeNetFromGross (inversa)", () => {
    it("es la inversa exacta de computeOfferGrossPrice para valores redondos", () => {
      const { grossArs } = computeOfferGrossPrice(1000);
      expect(computeNetFromGross(grossArs)).toBe(1000);
    });

    it("caso borde de redondeo: bruto que no divide exacto por (1+rate)", () => {
      // 4999 / 1.15 = 4346.9565... -> redondea a 4346.96
      expect(computeNetFromGross(4999)).toBe(4346.96);
    });
  });

  describe("decomposeOfferGrossPrice", () => {
    it("devuelve el desglose completo a partir del bruto persistido", () => {
      expect(decomposeOfferGrossPrice(1150)).toEqual({ netArs: 1000, commissionAmountArs: 150, grossArs: 1150 });
    });

    it("netArs + commissionAmountArs === grossArs incluso en el caso borde de redondeo", () => {
      const { netArs, commissionAmountArs, grossArs } = decomposeOfferGrossPrice(4999);
      expect(netArs).toBe(4346.96);
      expect(Math.round((netArs + commissionAmountArs) * 100) / 100).toBe(grossArs);
    });

    it("respeta una tasa explícita distinta a la vigente en env", () => {
      expect(decomposeOfferGrossPrice(1100, 0.1)).toEqual({ netArs: 1000, commissionAmountArs: 100, grossArs: 1100 });
    });

    it("usa MOVO_COMMISSION_RATE de env cuando no se pasa una tasa explícita", () => {
      process.env.MOVO_COMMISSION_RATE = "0.2";
      __resetCommissionConfigForTests();
      expect(decomposeOfferGrossPrice(1200)).toEqual({ netArs: 1000, commissionAmountArs: 200, grossArs: 1200 });
    });
  });

  describe("parseRate", () => {
    it("parsea una tasa numérica válida", () => {
      expect(parseRate("0.0499", 0.1)).toBe(0.0499);
    });

    it("cae al default si la var falta, está vacía, no es numérica o es negativa", () => {
      expect(parseRate(undefined, 0.1)).toBe(0.1);
      expect(parseRate("", 0.1)).toBe(0.1);
      expect(parseRate("4,99%", 0.1)).toBe(0.1);
      expect(parseRate("-0.05", 0.1)).toBe(0.1);
    });

    it("getCommissionConfig no devuelve NaN con una env var mal escrita", () => {
      process.env.MP_TRANSACTION_FEE_RATE = "4,99%";
      __resetCommissionConfigForTests();
      expect(getCommissionConfig().mpTransactionFeeRate).toBe(0.0499);
    });
  });

  describe("estimateMpFeeArs", () => {
    it("aplica la tasa sobre el bruto y redondea a 2 decimales", () => {
      expect(estimateMpFeeArs(1150)).toBe(57.39);
      expect(estimateMpFeeArs(1000, 0.041)).toBe(41);
    });
  });

  describe("estimateReceivedArs", () => {
    it("resta del neto el estimado de MP calculado sobre el bruto", () => {
      // 1000 neto, 1150 bruto: fee = 1150 * 0.0499 = 57.39 (redondeado) -> 942.61
      expect(estimateReceivedArs(1000, 1150)).toBe(942.61);
      expect(estimateReceivedArs(1000, 1150, 0.04)).toBe(954);
    });

    it("nunca devuelve un monto negativo", () => {
      expect(estimateReceivedArs(10, 1000, 0.5)).toBe(0);
    });
  });

  describe("carrierPaymentView (MOVO-311)", () => {
    it("saca el recargo del emisor del bruto y la comisión de MP sobre él del fee: el desglose cierra con el neto", () => {
      // Pago 1350 (precio 1150 + recargo 200), MP 67,37, fee 440,02 (150 comisión + 100 deuda propia + 190,02 del recargo).
      const view = carrierPaymentView({ grossAmountArs: 1350, mpFeeArs: 67.37, debtSurchargeArs: 200, debtSurchargeFeeArs: 190.02 });
      expect(view).toEqual({ grossAmountArs: 1150, mpFeeArs: 57.39 });
      expect(Math.round((view.grossAmountArs - (view.mpFeeArs as number) - 150 - 100) * 100) / 100).toBe(842.61);
    });

    it("sin recargo no cambia nada, y respeta un fee de MP todavía desconocido", () => {
      expect(carrierPaymentView({ grossAmountArs: 1150, mpFeeArs: 47.15, debtSurchargeArs: 0, debtSurchargeFeeArs: 0 })).toEqual({
        grossAmountArs: 1150,
        mpFeeArs: 47.15,
      });
      expect(carrierPaymentView({ grossAmountArs: 1350, mpFeeArs: null, debtSurchargeArs: 200, debtSurchargeFeeArs: 190.02 }).mpFeeArs).toBeNull();
    });

    it("MOVO-285: el fee del transportista nunca es negativo, aunque el recargo absorbido supere al fee real", () => {
      // Fee real de MP chico (4,1 %) y un recargo grande cuyo fee estimado (4,99 %) se pasó.
      expect(carrierPaymentView({ grossAmountArs: 1000, mpFeeArs: 5, debtSurchargeArs: 900, debtSurchargeFeeArs: 800 }).mpFeeArs).toBe(0);
    });
  });

  describe("cashPenaltyCompensationArs (MOVO-37)", () => {
    it("deja lo mismo que la captura parcial con tarjeta: penalidad − comisión del precio − fee de MP de la penalidad", () => {
      // Precio 11.500 (bruto con 15 %): comisión 1.500. Penalidad del 25 %: 2.875. Fee de MP 5 % de 2.875: 143,75.
      expect(cashPenaltyCompensationArs(11500, 2875, { commissionRate: 0.15, mpRate: 0.05 })).toBe(1231.25);
    });

    it("nunca es negativa cuando la penalidad no cubre la comisión", () => {
      expect(cashPenaltyCompensationArs(11500, 1000, { commissionRate: 0.15, mpRate: 0.05 })).toBe(0);
    });
  });
});
