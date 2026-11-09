import { registerStepProgress, visibleRegisterSteps } from "../src/lib/register-steps";

describe("pasos visibles del registro", () => {
  it("con el código SMS cuenta los cuatro pasos", () => {
    expect(visibleRegisterSteps(false)).toEqual([0, 1, 2, 3]);
    expect(registerStepProgress(2, false)).toEqual({ position: 3, total: 4, fraction: 0.75, label: "Paso 3" });
  });

  it("con el teléfono ya verificado el paso del código deja de contar", () => {
    expect(visibleRegisterSteps(true)).toEqual([0, 2, 3]);
    expect(registerStepProgress(0, true)).toMatchObject({ position: 1, total: 3, label: "Paso 1" });
    expect(registerStepProgress(2, true)).toMatchObject({ position: 2, total: 3, label: "Paso 2" });
    expect(registerStepProgress(3, true)).toMatchObject({ position: 3, total: 3, fraction: 1, label: "Paso 3" });
  });

  it("la barra avanza de a un tramo en cada camino, sin saltos", () => {
    const forward = (skipped: boolean) =>
      visibleRegisterSteps(skipped).map((s) => registerStepProgress(s, skipped).fraction);
    expect(forward(false)).toEqual([0.25, 0.5, 0.75, 1]);
    expect(forward(true).map((f) => Number(f.toFixed(2)))).toEqual([0.33, 0.67, 1]);
  });
});
