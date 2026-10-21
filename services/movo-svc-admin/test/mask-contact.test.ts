import { describe, expect, it } from "vitest";
import { maskContact, maskEmail, maskPhone } from "../src/utils/mask-contact";

describe("enmascarado del contacto para la bitácora (MOVO-294)", () => {
  it("deja la primera y la última letra del email y el dominio", () => {
    expect(maskEmail("juan.perez@gmail.com")).toBe("j********z@gmail.com");
    expect(maskEmail("ab@movo.test")).toBe("**@movo.test");
    expect(maskEmail("sin-arroba")).toBe("***");
  });

  it("deja los últimos 4 dígitos del teléfono", () => {
    expect(maskPhone("+5493511234567")).toBe("•••• 4567");
    expect(maskPhone("12")).toBe("••••");
  });

  it("elige según el campo", () => {
    expect(maskContact("email", "ana@movo.test")).toBe("a*a@movo.test");
    expect(maskContact("phone", "+5493511234567")).toBe("•••• 4567");
  });
});
