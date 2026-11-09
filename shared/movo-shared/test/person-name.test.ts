import { describe, expect, it } from "vitest";
import { normalizePersonName } from "../src";

describe("normalizePersonName", () => {
  it("pasa un nombre en mayúsculas a inicial mayúscula en cada palabra", () => {
    expect(normalizePersonName("MARÍA JOSÉ")).toBe("María José");
    expect(normalizePersonName("PÉREZ GÓMEZ")).toBe("Pérez Gómez");
  });

  it("deja en minúscula las partículas salvo al principio", () => {
    expect(normalizePersonName("PÉREZ DE LA CRUZ")).toBe("Pérez de la Cruz");
    expect(normalizePersonName("MARÍA DE LOS ÁNGELES")).toBe("María de los Ángeles");
    expect(normalizePersonName("DEL VALLE")).toBe("Del Valle");
    expect(normalizePersonName("LA TORRE")).toBe("La Torre");
  });

  it("capitaliza cada tramo de un nombre con guion o apóstrofe", () => {
    expect(normalizePersonName("PÉREZ-GÓMEZ")).toBe("Pérez-Gómez");
    expect(normalizePersonName("ana-maría")).toBe("Ana-María");
    expect(normalizePersonName("O'BRIEN")).toBe("O'Brien");
    expect(normalizePersonName("d’angelo")).toBe("D’Angelo");
  });

  it("colapsa espacios y recorta los bordes", () => {
    expect(normalizePersonName("  juan   cruz ")).toBe("Juan Cruz");
  });

  it("es idempotente", () => {
    const once = normalizePersonName("BORDINO BLANCHE");
    expect(normalizePersonName(once)).toBe(once);
  });

  it("devuelve cadena vacía sin dato", () => {
    expect(normalizePersonName("")).toBe("");
    expect(normalizePersonName("   ")).toBe("");
    expect(normalizePersonName(null)).toBe("");
    expect(normalizePersonName(undefined)).toBe("");
  });
});
