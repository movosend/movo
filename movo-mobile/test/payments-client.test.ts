import { paymentsClient } from "../src/api/payments-client";
import { httpClient } from "../src/api/http-client";

jest.mock("../src/api/http-client", () => ({
  httpClient: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

describe("paymentsClient (MOVO-112)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("getMpConnectStatus envía GET /payments/mp-connect/status", async () => {
    const status = { status: "unlinked", account: null, invalidReason: null };
    (httpClient.get as jest.Mock).mockResolvedValueOnce(status);

    await expect(paymentsClient.getMpConnectStatus()).resolves.toEqual(status);
    expect(httpClient.get).toHaveBeenCalledWith("/payments/mp-connect/status");
  });

  it("getMpConnectAuthorizationUrl envía GET /payments/mp-connect/authorization-url", async () => {
    const response = { authorizationUrl: "https://auth.mercadopago.com/x", expiresAt: "2026-10-08T20:00:00Z" };
    (httpClient.get as jest.Mock).mockResolvedValueOnce(response);

    await expect(paymentsClient.getMpConnectAuthorizationUrl()).resolves.toEqual(response);
    expect(httpClient.get).toHaveBeenCalledWith("/payments/mp-connect/authorization-url");
  });

  it("unlinkMpAccount envía DELETE /payments/mp-connect", async () => {
    (httpClient.delete as jest.Mock).mockResolvedValueOnce(undefined);

    await paymentsClient.unlinkMpAccount();
    expect(httpClient.delete).toHaveBeenCalledWith("/payments/mp-connect");
  });

  describe("tarjetas guardadas (MOVO-101)", () => {
    it("getCardsCheckoutData envía GET /payments/cards/checkout-data", async () => {
      (httpClient.get as jest.Mock).mockResolvedValueOnce({ publicKey: "TEST-pk" });
      await expect(paymentsClient.getCardsCheckoutData()).resolves.toEqual({ publicKey: "TEST-pk" });
      expect(httpClient.get).toHaveBeenCalledWith("/payments/cards/checkout-data");
    });

    it("listSavedCards envía GET /payments/cards", async () => {
      (httpClient.get as jest.Mock).mockResolvedValueOnce([]);
      await paymentsClient.listSavedCards();
      expect(httpClient.get).toHaveBeenCalledWith("/payments/cards");
    });

    it("createSavedCard envía POST /payments/cards con el token", async () => {
      (httpClient.post as jest.Mock).mockResolvedValueOnce({ id: "c1" });
      await paymentsClient.createSavedCard({ cardToken: "tok", alias: "Personal" });
      expect(httpClient.post).toHaveBeenCalledWith("/payments/cards", { cardToken: "tok", alias: "Personal" });
    });

    it("setDefaultCard, updateCardAlias y deleteSavedCard usan el id", async () => {
      await paymentsClient.setDefaultCard("c1");
      expect(httpClient.patch).toHaveBeenCalledWith("/payments/cards/c1/default");
      await paymentsClient.updateCardAlias("c1", null);
      expect(httpClient.patch).toHaveBeenCalledWith("/payments/cards/c1", { alias: null });
      await paymentsClient.deleteSavedCard("c1");
      expect(httpClient.delete).toHaveBeenCalledWith("/payments/cards/c1");
    });
  });
});
