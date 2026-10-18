import { payBalanceWithSavedCard } from "../src/lib/pay-balance-flow";
import { createSavedCardToken } from "../src/lib/mp-card-tokenizer";
import { paymentsClient } from "../src/api/payments-client";

jest.mock("../src/lib/mp-card-tokenizer", () => ({ createSavedCardToken: jest.fn() }));
jest.mock("../src/api/payments-client", () => ({ paymentsClient: { payBalance: jest.fn() } }));

describe("payBalanceWithSavedCard", () => {
  beforeEach(() => jest.clearAllMocks());

  it("tokeniza con la publicKey de Movo y nunca envía CVV al backend", async () => {
    (createSavedCardToken as jest.Mock).mockResolvedValue("tok_one_use");
    (paymentsClient.payBalance as jest.Mock).mockResolvedValue({ attemptId: "a", status: "approved", failureReason: null, balanceArs: 400 });
    const result = await payBalanceWithSavedCard({ payData: { publicKey: "movo_public_key", balanceArs: 1000 }, card: { id: "saved-1", mpCardId: "mp-card-1" }, cvv: "123", amountArs: 600 });
    expect(createSavedCardToken).toHaveBeenCalledWith("movo_public_key", { cardId: "mp-card-1", securityCode: "123" });
    expect(paymentsClient.payBalance).toHaveBeenCalledWith({ amountArs: 600, cardToken: "tok_one_use", savedCardId: "saved-1" });
    expect(JSON.stringify((paymentsClient.payBalance as jest.Mock).mock.calls)).not.toContain("123");
    expect(result.balanceArs).toBe(400);
  });
});
