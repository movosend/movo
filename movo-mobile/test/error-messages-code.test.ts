import { messageForCode } from "../src/lib/error-messages";

describe("messageForCode", () => {
  it("traduce un código conocido", () => {
    expect(messageForCode("MP_CONNECT_ACCESS_DENIED", "fallback")).toMatch(/No autorizaste a Movo/);
  });

  it("cae al fallback si el código no tiene traducción", () => {
    expect(messageForCode("SOME_UNKNOWN_CODE" as never, "fallback")).toBe("fallback");
  });
});

describe("MOVO-117: errores de requisitos del transportista", () => {
  it.each([
    ["CARRIER_LICENSE_NOT_APPROVED", /licencia/],
    ["CARRIER_MP_ACCOUNT_NOT_LINKED", /Mercado Pago/],
    ["USERS_SERVICE_UNAVAILABLE", /Intentá de nuevo/],
    ["PAYMENTS_SERVICE_UNAVAILABLE", /Intentá de nuevo/],
  ] as const)("%s tiene mensaje propio", (code, pattern) => {
    expect(messageForCode(code, "fallback")).toMatch(pattern);
  });
});

describe("MOVO-308: cancelación con penalidad", () => {
  it("CANCELLATION_PENALTY_MISMATCH tiene mensaje propio", () => {
    expect(messageForCode("CANCELLATION_PENALTY_MISMATCH", "fallback")).toMatch(/penalidad cambió/);
  });
});
