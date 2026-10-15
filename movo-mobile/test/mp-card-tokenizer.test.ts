import {
  CardTokenError,
  createCardToken,
  createSavedCardToken,
  failureFromMpBody,
  lookupBin,
} from "../src/lib/mp-card-tokenizer";

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

const CARD = {
  cardNumber: "4075595716483764",
  expMonth: 11,
  expYear: 2030,
  securityCode: "123",
  holderName: "APRO",
  docType: "DNI" as const,
  docNumber: "12345678",
};

describe("mp-card-tokenizer (MOVO-101)", () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  it("tokeniza contra MP con la public_key de Movo y devuelve el token (AC3)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "tok-123" }, 201));
    await expect(createCardToken("TEST-pk", CARD)).resolves.toBe("tok-123");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.mercadopago.com/v1/card_tokens?public_key=TEST-pk");
    expect(JSON.parse(init.body as string)).toEqual({
      card_number: "4075595716483764",
      expiration_month: 11,
      expiration_year: 2030,
      security_code: "123",
      cardholder: { name: "APRO", identification: { type: "DNI", number: "12345678" } },
    });
  });

  it("tokeniza una tarjeta guardada con card_id + CVV y la public_key del transportista (MOVO-269)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "tok-saved" }, 201));
    await expect(createSavedCardToken("TEST-carrier-pk", { cardId: "mp-card-1", securityCode: "123" })).resolves.toBe(
      "tok-saved",
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.mercadopago.com/v1/card_tokens?public_key=TEST-carrier-pk");
    expect(JSON.parse(init.body as string)).toEqual({ card_id: "mp-card-1", security_code: "123" });
  });

  it("un CVV rechazado por MP al tokenizar la tarjeta guardada tira CardTokenError (MOVO-269)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ cause: [{ code: "E203" }] }, 400));
    await expect(createSavedCardToken("TEST-pk", { cardId: "c", securityCode: "12" })).rejects.toMatchObject({
      failure: { reason: "invalid_security_code" },
    });
  });

  it("traduce el cause de MP a un motivo con el dato a corregir (AC4)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ cause: [{ code: "E302", description: "invalid" }] }, 400));
    await expect(createCardToken("TEST-pk", CARD)).rejects.toMatchObject({
      failure: { reason: "invalid_security_code", field: "security_code" },
    });
    expect(failureFromMpBody({ cause: [{ code: 325 }] })).toEqual({ reason: "invalid_expiration", field: "expiration" });
    expect(failureFromMpBody({ message: "algo" })).toEqual({ reason: "unknown", field: null });
  });

  it("sin red tira un error de red", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Network request failed"));
    const error = await createCardToken("TEST-pk", CARD).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CardTokenError);
    expect((error as CardTokenError).failure.reason).toBe("network");
  });

  it("consulta el BIN y devuelve banco, tipo y largos", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        results: [
          {
            id: "visa",
            payment_type_id: "credit_card",
            issuer: { id: 1, name: "Banco Galicia" },
            settings: [{ card_number: { length: 16 }, security_code: { length: 3 } }],
          },
        ],
      }),
    );
    await expect(lookupBin("TEST-pk", "407559")).resolves.toEqual({
      paymentMethodId: "visa",
      paymentType: "credit_card",
      issuerName: "Banco Galicia",
      cardNumberLength: 16,
      securityCodeLength: 3,
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.mercadopago.com/v1/payment_methods/search?public_key=TEST-pk&bins=407559",
    );
  });

  it("un BIN que MP no reconoce no corta el alta", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [] }));
    await expect(lookupBin("TEST-pk", "999999")).resolves.toBeNull();
  });
});
