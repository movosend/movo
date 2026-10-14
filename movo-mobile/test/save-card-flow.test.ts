import { saveNewCard } from "../src/lib/save-card-flow";
import { paymentsClient } from "../src/api/payments-client";
import { createCardToken } from "../src/lib/mp-card-tokenizer";

jest.mock("../src/api/payments-client", () => ({
  paymentsClient: { createSavedCard: jest.fn(), setDefaultCard: jest.fn() },
}));
jest.mock("../src/lib/mp-card-tokenizer", () => ({
  ...jest.requireActual("../src/lib/mp-card-tokenizer"),
  createCardToken: jest.fn(),
}));

const CARD = {
  cardNumber: "4075595716483764",
  expMonth: 11,
  expYear: 2030,
  securityCode: "123",
  holderName: "APRO",
  docType: "DNI" as const,
  docNumber: "12345678",
};
const SAVED = { id: "card-1", isDefault: false };

describe("saveNewCard (MOVO-101)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (createCardToken as jest.Mock).mockResolvedValue("tok-1");
    (paymentsClient.createSavedCard as jest.Mock).mockResolvedValue(SAVED);
  });

  it("al backend solo viaja el token y el nombre: nunca el número ni el CVV (AC3)", async () => {
    await saveNewCard({ publicKey: "TEST-pk", card: CARD, paymentMethodId: "visa", alias: "Personal", makeDefault: false });

    expect(createCardToken).toHaveBeenCalledWith("TEST-pk", CARD);
    expect(paymentsClient.createSavedCard).toHaveBeenCalledWith({
      cardToken: "tok-1",
      paymentMethodId: "visa",
      alias: "Personal",
    });
    const body = JSON.stringify((paymentsClient.createSavedCard as jest.Mock).mock.calls[0][0]);
    expect(body).not.toContain("4075595716483764");
    expect(body).not.toContain("3764");
    expect(body).not.toContain('"123"');
    expect(body).not.toContain("12345678");
  });

  it("sin nombre de referencia no lo manda (AC10)", async () => {
    await saveNewCard({ publicKey: "TEST-pk", card: CARD, paymentMethodId: null, alias: null, makeDefault: false });
    expect(paymentsClient.createSavedCard).toHaveBeenCalledWith({ cardToken: "tok-1" });
    expect(paymentsClient.setDefaultCard).not.toHaveBeenCalled();
  });

  it("si pidió predeterminada y el backend no la dejó así, la marca", async () => {
    (paymentsClient.setDefaultCard as jest.Mock).mockResolvedValue({ ...SAVED, isDefault: true });
    await expect(
      saveNewCard({ publicKey: "TEST-pk", card: CARD, paymentMethodId: null, alias: null, makeDefault: true }),
    ).resolves.toEqual({ ...SAVED, isDefault: true });
    expect(paymentsClient.setDefaultCard).toHaveBeenCalledWith("card-1");
  });

  it("si MP rechaza la tarjeta no llama al backend", async () => {
    (createCardToken as jest.Mock).mockRejectedValue(new Error("rechazada"));
    await expect(
      saveNewCard({ publicKey: "TEST-pk", card: CARD, paymentMethodId: null, alias: null, makeDefault: false }),
    ).rejects.toThrow("rechazada");
    expect(paymentsClient.createSavedCard).not.toHaveBeenCalled();
  });
});
