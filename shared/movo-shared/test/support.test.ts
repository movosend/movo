import { describe, expect, it } from "vitest";
import { formatSupportCode, supportShipmentCode } from "../src/types/support";
import { SUPPORT_CODE_RE } from "../src/types/admin-support";

describe("códigos de display de soporte (MOVO-320)", () => {
  it("formatSupportCode arma SOP-NNNN con al menos 4 dígitos y respeta SUPPORT_CODE_RE", () => {
    expect(formatSupportCode(7)).toBe("SOP-0007");
    expect(formatSupportCode(1042)).toBe("SOP-1042");
    expect(formatSupportCode(123456)).toBe("SOP-123456");
    for (const n of [1, 1042, 123456]) expect(SUPPORT_CODE_RE.test(formatSupportCode(n))).toBe(true);
  });

  it("supportShipmentCode toma los últimos 5 dígitos del UUID, sin el #", () => {
    expect(supportShipmentCode("3f2a9c1e-0b4d-4e7a-9d21-8c5b17a64213")).toBe("MOVO-64213");
    expect(supportShipmentCode("abc")).toBe("MOVO-00000");
  });
});
