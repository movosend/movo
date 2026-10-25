import { describe, expect, it } from "vitest";
import {
  PACKAGE_DIMENSION_CM_MAX,
  PACKAGE_DIMENSION_CM_MIN,
  PACKAGE_DIMENSION_CM_OPTIONS,
  PACKAGE_DIMENSION_CM_STEP,
  PACKAGE_WEIGHT_KG_MIN,
  PACKAGE_WEIGHT_KG_STEP,
  roundPackageWeightKg,
} from "../src/config/package-dimensions";

describe("opciones de medida del wizard (MOVO-317)", () => {
  it("van de 10 a 300 cm de a 10", () => {
    expect(PACKAGE_DIMENSION_CM_MIN).toBe(10);
    expect(PACKAGE_DIMENSION_CM_STEP).toBe(10);
    expect(PACKAGE_DIMENSION_CM_MAX).toBe(300);
    expect(PACKAGE_DIMENSION_CM_OPTIONS).toHaveLength(30);
    expect(PACKAGE_DIMENSION_CM_OPTIONS[0]).toBe(10);
    expect(PACKAGE_DIMENSION_CM_OPTIONS[1]).toBe(20);
    expect(PACKAGE_DIMENSION_CM_OPTIONS.at(-1)).toBe(300);
  });
});

describe("roundPackageWeightKg", () => {
  it("el peso mínimo y el paso son de 0,5 kg", () => {
    expect(PACKAGE_WEIGHT_KG_MIN).toBe(0.5);
    expect(PACKAGE_WEIGHT_KG_STEP).toBe(0.5);
  });

  it.each([
    [2.3, 2.5],
    [2.2, 2],
    [2.25, 2.5],
    [0.74, 0.5],
    [0.75, 1],
    [250, 250],
    [1000.7, 1000.5],
  ])("redondea %s kg al múltiplo de 0,5 más cercano (%s)", (input, expected) => {
    expect(roundPackageWeightKg(input)).toBe(expected);
  });

  it("nunca baja del mínimo", () => {
    expect(roundPackageWeightKg(0.1)).toBe(0.5);
    expect(roundPackageWeightKg(0.2)).toBe(0.5);
  });
});

describe("tope de cordura", () => {
  it("es de 10.000 y cubre las medidas del wizard", async () => {
    const { PACKAGE_INPUT_SANITY_MAX } = await import("../src/config/package-dimensions");
    expect(PACKAGE_INPUT_SANITY_MAX).toBe(10_000);
    expect(PACKAGE_INPUT_SANITY_MAX).toBeGreaterThan(PACKAGE_DIMENSION_CM_MAX);
  });
});
