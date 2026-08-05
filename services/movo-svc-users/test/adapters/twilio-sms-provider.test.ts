import { describe, it, expect, vi, beforeEach } from "vitest";

// Única excepción justificada a "nunca mockeado" (regla de CLAUDE.md para tests de
// integración contra DB/Redis reales): Twilio es una API externa de pago — pegarle de
// verdad en cada corrida de CI cuesta dinero real y depende de red, exactamente el
// riesgo que R10/R11 del plan de proyecto piden evitar con mocks. El resto del test
// suite de MOVO-71 (Redis, Fastify) sí corre contra infraestructura real.
const createMock = vi.fn().mockResolvedValue({ sid: "SM_test" });
const twilioFactoryMock = vi.fn(() => ({ messages: { create: createMock } }));

vi.mock("twilio", () => ({ default: twilioFactoryMock }));

const { createTwilioSmsProvider } = await import("../../src/adapters/twilio-sms-provider");

describe("Twilio SMS Provider (adapter concreto, AC8)", () => {
  beforeEach(() => {
    createMock.mockClear();
    twilioFactoryMock.mockClear();
  });

  it("instancia el cliente de Twilio con API Key SID/Secret, pasando accountSid en opts (no como credencial)", async () => {
    createTwilioSmsProvider({
      accountSid: "AC_test",
      apiKeySid: "SK_test",
      apiKeySecret: "secret_test",
      fromNumber: "+15005550006",
    });

    expect(twilioFactoryMock).toHaveBeenCalledWith("SK_test", "secret_test", { accountSid: "AC_test" });
  });

  it("send() llama a client.messages.create con to/from y el código en el body", async () => {
    const provider = createTwilioSmsProvider({
      accountSid: "AC_test",
      apiKeySid: "SK_test",
      apiKeySecret: "secret_test",
      fromNumber: "+15005550006",
    });

    await provider.send("+5493511234567", "482913");

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenCalledWith({
      to: "+543511234567",
      from: "+15005550006",
      body: expect.stringContaining("482913"),
    });
  });

  it("saca el '9' de móvil argentino del 'to' antes de mandarlo a Twilio (no lo reconoce para SMS, verificado empíricamente contra la API real)", async () => {
    const provider = createTwilioSmsProvider({
      accountSid: "AC_test",
      apiKeySid: "SK_test",
      apiKeySecret: "secret_test",
      fromNumber: "+15005550006",
    });

    await provider.send("+5493516782880", "111111");

    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ to: "+543516782880" }));
  });

  it("no toca números que no matchean el patrón +549 + 10 dígitos (otros países quedan intactos)", async () => {
    const provider = createTwilioSmsProvider({
      accountSid: "AC_test",
      apiKeySid: "SK_test",
      apiKeySecret: "secret_test",
      fromNumber: "+15005550006",
    });

    await provider.send("+15005550001", "222222");

    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ to: "+15005550001" }));
  });
});
