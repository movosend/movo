import { ApiError } from "@movo/shared/dist/errors/api-error";
import { fundingClient } from "../src/api/funding-client";
import { CardTokenError, createSavedCardToken } from "../src/lib/mp-card-tokenizer";
import { fundWithToken, tokenizeSavedCard } from "../src/lib/pay-shipment-flow";

jest.mock("../src/api/funding-client", () => ({ fundingClient: { fund: jest.fn() } }));
jest.mock("../src/lib/mp-card-tokenizer", () => ({
  ...jest.requireActual("../src/lib/mp-card-tokenizer"),
  createSavedCardToken: jest.fn(),
}));

const TOKENIZE_INPUT = {
  funding: { carrierPublicKey: "TEST-carrier-pk" },
  card: { mpCardId: "mp-card-1" },
  cvv: "123",
};
const INPUT = { shipmentId: "s1", cardToken: "tok-1", savedCardId: "card-1" };

describe("pago con tarjeta guardada (MOVO-269)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (createSavedCardToken as jest.Mock).mockResolvedValue("tok-1");
  });

  it("tokeniza con la public_key del transportista y devuelve solo el token", async () => {
    await expect(tokenizeSavedCard(TOKENIZE_INPUT)).resolves.toEqual({ kind: "token", cardToken: "tok-1" });
    expect(createSavedCardToken).toHaveBeenCalledWith("TEST-carrier-pk", { cardId: "mp-card-1", securityCode: "123" });
  });

  it("manda al backend solo token + tarjeta, nunca el CVV ni el id de MP (AC3)", async () => {
    (fundingClient.fund as jest.Mock).mockResolvedValue({ funded: true, failureReason: null, payUntil: null });
    await expect(fundWithToken(INPUT)).resolves.toEqual({ kind: "reserved" });

    expect(fundingClient.fund).toHaveBeenCalledWith("s1", { cardToken: "tok-1", savedCardId: "card-1" });
    const body = JSON.stringify((fundingClient.fund as jest.Mock).mock.calls[0][1]);
    expect(body).not.toContain("123");
    expect(body).not.toContain("mp-card-1");
  });

  it.each(["insufficient_funds", "card_rejected", "invalid_data", "platform_error"] as const)(
    "un rechazo %s vuelve como resultado, no como error (AC4)",
    async (reason) => {
      (fundingClient.fund as jest.Mock).mockResolvedValue({ funded: false, failureReason: reason, payUntil: "2026-10-20T10:00:00Z" });
      await expect(fundWithToken(INPUT)).resolves.toEqual({
        kind: "rejected",
        reason,
        payUntil: "2026-10-20T10:00:00Z",
      });
    },
  );

  it("funded:false sin motivo es una reserva todavía en proceso", async () => {
    (fundingClient.fund as jest.Mock).mockResolvedValue({ funded: false, failureReason: null, payUntil: null });
    await expect(fundWithToken(INPUT)).resolves.toEqual({ kind: "pending", payUntil: null });
  });

  it("un 409 SHIPMENT_FUNDING_NOT_AVAILABLE es plazo vencido / envío que cambió", async () => {
    const error = new ApiError(409, "SHIPMENT_FUNDING_NOT_AVAILABLE", "vencido");
    (fundingClient.fund as jest.Mock).mockRejectedValue(error);
    await expect(fundWithToken(INPUT)).resolves.toEqual({ kind: "unavailable", error });
  });

  it("otros errores del backend vuelven como error (SAVED_CARD_NOT_FOUND, 502...)", async () => {
    const error = new ApiError(404, "SAVED_CARD_NOT_FOUND", "no existe");
    (fundingClient.fund as jest.Mock).mockRejectedValue(error);
    await expect(fundWithToken(INPUT)).resolves.toEqual({ kind: "error", error });
  });

  it("si MP rechaza el token vuelve como token_error", async () => {
    const error = new CardTokenError({ reason: "invalid_security_code", field: "security_code" });
    (createSavedCardToken as jest.Mock).mockRejectedValue(error);
    await expect(tokenizeSavedCard(TOKENIZE_INPUT)).resolves.toEqual({ kind: "token_error", error });
  });

  it("sin red al tokenizar es un token_error de red", async () => {
    const error = new CardTokenError({ reason: "network", field: null });
    (createSavedCardToken as jest.Mock).mockRejectedValue(error);
    const out = await tokenizeSavedCard(TOKENIZE_INPUT);
    expect(out).toMatchObject({ kind: "token_error", error: { failure: { reason: "network" } } });
  });

  it("un error inesperado al tokenizar vuelve como error", async () => {
    const error = new Error("boom");
    (createSavedCardToken as jest.Mock).mockRejectedValue(error);
    await expect(tokenizeSavedCard(TOKENIZE_INPUT)).resolves.toEqual({ kind: "error", error });
  });
});
