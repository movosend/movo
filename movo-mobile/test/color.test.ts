import { hexToRgba } from "../src/lib/color";

describe("hexToRgba", () => {
  it("arma el rgba con el alpha", () => {
    expect(hexToRgba("#0A0A0B", 0.5)).toBe("rgba(10,10,11,0.5)");
    expect(hexToRgba("#FFFFFF", 1)).toBe("rgba(255,255,255,1)");
  });

  it("un alpha casi cero nunca queda en notación científica (Reanimated lo rechaza como color)", () => {
    const color = hexToRgba("#0A0A0B", 8.514944305204608e-11);
    expect(color).toBe("rgba(10,10,11,0)");
    expect(color).not.toMatch(/e-/);
  });

  it("acota el alpha a 0..1, redondea a 3 decimales y sin número válido queda opaco", () => {
    expect(hexToRgba("#0A0A0B", 1.2)).toBe("rgba(10,10,11,1)");
    expect(hexToRgba("#0A0A0B", -0.3)).toBe("rgba(10,10,11,0)");
    expect(hexToRgba("#0A0A0B", 0.123456)).toBe("rgba(10,10,11,0.123)");
    expect(hexToRgba("#0A0A0B", Number.NaN)).toBe("rgba(10,10,11,1)");
  });
});
