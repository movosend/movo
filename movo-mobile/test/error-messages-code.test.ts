import { messageForCode } from "../src/lib/error-messages";

describe("messageForCode", () => {
  it("traduce un código conocido", () => {
    expect(messageForCode("MP_CONNECT_ACCESS_DENIED", "fallback")).toMatch(/No autorizaste a Movo/);
  });

  it("cae al fallback si el código no tiene traducción", () => {
    expect(messageForCode("SOME_UNKNOWN_CODE" as never, "fallback")).toBe("fallback");
  });
});
