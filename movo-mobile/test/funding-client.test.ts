import { fundingClient } from "../src/api/funding-client";
import { httpClient } from "../src/api/http-client";

jest.mock("../src/api/http-client", () => ({
  httpClient: { get: jest.fn(), post: jest.fn() },
}));

describe("fundingClient (MOVO-269)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("getFunding pide GET /shipments/:id/funding", async () => {
    (httpClient.get as jest.Mock).mockResolvedValue({ carrierPublicKey: "TEST-pk" });
    await expect(fundingClient.getFunding("s1")).resolves.toEqual({ carrierPublicKey: "TEST-pk" });
    expect(httpClient.get).toHaveBeenCalledWith("/shipments/s1/funding");
  });

  it("fund manda POST /shipments/:id/funding solo con el token y la tarjeta guardada", async () => {
    (httpClient.post as jest.Mock).mockResolvedValue({ funded: true });
    await fundingClient.fund("s1", { cardToken: "tok", savedCardId: "card-1" });
    expect(httpClient.post).toHaveBeenCalledWith("/shipments/s1/funding", { cardToken: "tok", savedCardId: "card-1" });
    const body = JSON.stringify((httpClient.post as jest.Mock).mock.calls[0][1]);
    expect(body).not.toMatch(/cvv|security|number/i);
  });
});
