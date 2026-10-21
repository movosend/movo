import { describe, expect, it } from "vitest";
import { DEFAULT_PACKAGE_LIMITS, packageLimitViolations } from "../src/domain/package-limits";

const pkg = (weightKg: number, lengthCm: number, widthCm: number, heightCm: number) => ({
  weightKg,
  lengthCm,
  widthCm,
  heightCm,
});

describe("packageLimitViolations (MOVO-276)", () => {
  it.each([
    ["en todos los límites a la vez", pkg(30, 150, 100, 50)],
    ["el cubo más grande que entra (100 cm, 1 m³)", pkg(0.1, 100, 100, 100)],
    ["un sobre", pkg(0.2, 30, 22, 1)],
  ])("acepta un paquete %s", (_label, p) => {
    expect(packageLimitViolations(p, DEFAULT_PACKAGE_LIMITS)).toEqual([]);
  });

  it("informa cada límite excedido, en orden peso → lado → suma", () => {
    expect(packageLimitViolations(pkg(31, 160, 100, 50), DEFAULT_PACKAGE_LIMITS)).toEqual([
      "peso de 31 kg (máximo 30 kg)",
      "lado de 160 cm (máximo 150 cm)",
      "suma de lados de 310 cm (máximo 300 cm)",
    ]);
  });

  it("toma el lado más largo, sin importar en qué medida venga", () => {
    expect(packageLimitViolations(pkg(1, 10, 10, 151), DEFAULT_PACKAGE_LIMITS)).toEqual([
      "lado de 151 cm (máximo 150 cm)",
    ]);
  });

  it("formatea decimales sin ceros de más, igual que pricing", () => {
    expect(packageLimitViolations(pkg(30.5, 10, 10, 10), DEFAULT_PACKAGE_LIMITS)).toEqual([
      "peso de 30.5 kg (máximo 30 kg)",
    ]);
  });

  it("usa los límites que recibe, no los defaults", () => {
    const limits = { maxWeightKg: 20, maxSideCm: 80, maxSidesSumCm: 150 };
    expect(packageLimitViolations(pkg(25, 60, 60, 40), limits)).toEqual([
      "peso de 25 kg (máximo 20 kg)",
      "suma de lados de 160 cm (máximo 150 cm)",
    ]);
  });
});
