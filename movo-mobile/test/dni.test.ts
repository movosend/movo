import { formatDni, isDniValid } from "../src/lib/dni";

describe("dni", () => {
  it("acepta 7 u 8 dígitos, con o sin puntos", () => {
    expect(isDniValid("36789012")).toBe(true);
    expect(isDniValid("36.789.012")).toBe(true);
    expect(isDniValid("1234567")).toBe(true);
    expect(isDniValid("123456")).toBe(false);
    expect(isDniValid("123456789")).toBe(false);
  });

  it("formatea con puntos y corta en 8 dígitos", () => {
    expect(formatDni("36789012")).toBe("36.789.012");
    expect(formatDni("367890123")).toBe("36.789.012");
    expect(formatDni("12")).toBe("12");
  });
});
