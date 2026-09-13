import { afterEach, describe, expect, it } from "vitest";
import {
  __resetCommissionConfigForTests,
  computeNetFromGross,
  computeOfferGrossPrice,
  decomposeOfferGrossPrice,
} from "../src/config/commission";

describe("commission", () => {
  afterEach(() => {
    delete process.env.MOVO_COMMISSION_RATE;
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
});
