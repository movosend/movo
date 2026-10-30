import { carrierPriceBreakdown } from "../src/lib/payment-method";

describe("carrierPriceBreakdown (MOVO-37)", () => {
  it("en efectivo cobra el bruto en mano, sin fee de MP ni descuento por deuda", () => {
    expect(carrierPriceBreakdown({ grossArs: 1150, netArs: 1000, cash: true, debtDiscountArs: 200 })).toEqual({
      beforeDebtArs: 1150,
      receivedArs: 1150,
      commissionArs: 150,
    });
  });

  it("con tarjeta descuenta el estimado de MP y después la deuda, sin bajar de cero", () => {
    const base = carrierPriceBreakdown({ grossArs: 1150, netArs: 1000, cash: false });
    expect(base.beforeDebtArs).toBeLessThan(1000);
    expect(base.receivedArs).toBe(base.beforeDebtArs);
    expect(carrierPriceBreakdown({ grossArs: 1150, netArs: 1000, cash: false, debtDiscountArs: 100 }).receivedArs).toBe(
      base.beforeDebtArs - 100,
    );
    expect(carrierPriceBreakdown({ grossArs: 1150, netArs: 1000, cash: false, debtDiscountArs: 99999 }).receivedArs).toBe(0);
  });

  it("usa la comisión ya calculada cuando existe", () => {
    expect(carrierPriceBreakdown({ grossArs: 1150, netArs: 1000, cash: true, commissionArs: 149 }).commissionArs).toBe(149);
  });
});
