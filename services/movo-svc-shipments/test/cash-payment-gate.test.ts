import { ApiError } from "@movo/shared";
import { describe, expect, it } from "vitest";
import {
  assertCarrierWithinCashDebtLimit,
  exceedsCashDebtLimit,
  requireCashDebtLimit,
} from "../src/utils/cash-payment-gate";

describe("cash-payment-gate (MOVO-37)", () => {
  it("la deuda justo en el tope no lo supera, un peso más sí", () => {
    expect(exceedsCashDebtLimit(5000, 5000)).toBe(false);
    expect(exceedsCashDebtLimit(5000.01, 5000)).toBe(true);
  });

  it("assertCarrierWithinCashDebtLimit deja pasar hasta el tope y lanza 403 por encima", () => {
    expect(() => assertCarrierWithinCashDebtLimit(5000, 5000)).not.toThrow();
    try {
      assertCarrierWithinCashDebtLimit(6000, 5000);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).statusCode).toBe(403);
      expect((error as ApiError).code).toBe("CASH_DEBT_LIMIT_EXCEEDED");
      expect((error as ApiError).details).toEqual({ missingRequirements: ["cash_debt_within_limit"] });
    }
  });

  it("requireCashDebtLimit devuelve el tope y lanza si no está configurado", () => {
    expect(requireCashDebtLimit(5000, "x")).toBe(5000);
    expect(requireCashDebtLimit(0, "x")).toBe(0);
    expect(() => requireCashDebtLimit(undefined, "x")).toThrow(/cashShipmentMaxCarrierDebtArs \(x\)/);
  });
});
