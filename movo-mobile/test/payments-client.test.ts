import { paymentsClient } from "../src/api/payments-client";
import { httpClient } from "../src/api/http-client";

jest.mock("../src/api/http-client", () => ({
  httpClient: {
    get: jest.fn(),
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
});
