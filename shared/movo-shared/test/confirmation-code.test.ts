import { describe, expect, it } from "vitest";
import { normalizeConfirmationCode, shipmentConfirmationCode } from "../src";

describe("código de confirmación del envío (MOVO-333)", () => {
  it("son los últimos 5 dígitos del id con el prefijo MOVO-, igual que el encabezado del panel", () => {
    expect(shipmentConfirmationCode("7f3c9a10-1b2c-4d3e-8f90-a1b2c3d4e548")).toBe("MOVO-34548");
  });

  it("rellena con ceros si el id tiene menos de 5 dígitos", () => {
    expect(shipmentConfirmationCode("abcdef12-aaaa-bbbb-cccc-dddddddddd7a")).toBe("MOVO-00127");
    expect(shipmentConfirmationCode("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")).toBe("MOVO-00000");
  });

  it("lo tipeado se compara sin # inicial, sin espacios y sin distinguir mayúsculas", () => {
    for (const typed of ["MOVO-48213", "#MOVO-48213", "  #movo-48213  ", "movo-48213"]) {
      expect(normalizeConfirmationCode(typed)).toBe("MOVO-48213");
    }
    expect(normalizeConfirmationCode("MOVO-48214")).not.toBe("MOVO-48213");
  });
});
