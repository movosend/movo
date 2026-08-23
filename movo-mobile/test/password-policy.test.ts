import { isPasswordValid } from "../src/lib/password-policy";
import { isPasswordValid as reExported } from "../src/hooks/use-registration";

/**
 * MOVO-136 AC4: la validación de cliente tiene que espejar exactamente el `pattern`
 * del backend (`changePasswordBody.newPassword` de `users.schema.ts`, idéntico al del
 * registro): mínimo 8, al menos una letra, al menos un dígito.
 */
describe("isPasswordValid", () => {
  it.each([
    ["Password1", true],
    ["abcdefg1", true],
    ["12345678a", true],
    ["Contraseña1", true],
  ])("acepta %s", (value, expected) => {
    expect(isPasswordValid(value)).toBe(expected);
  });

  it.each([
    ["Pass1", "menos de 8 caracteres"],
    ["12345678", "sin ninguna letra"],
    ["abcdefgh", "sin ningún dígito"],
    ["", "vacía"],
  ])("rechaza %s (%s)", (value) => {
    expect(isPasswordValid(value)).toBe(false);
  });

  it("sigue exportándose desde use-registration.tsx para los callers del wizard", () => {
    expect(reExported).toBe(isPasswordValid);
  });
});
