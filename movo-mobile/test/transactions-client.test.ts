import { transactionsClient } from "../src/api/transactions-client";

const mockGet = jest.fn();
jest.mock("../src/api/http-client", () => ({
  httpClient: { get: (...args: unknown[]) => mockGet(...args) },
}));

describe("transactionsClient (MOVO-304)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGet.mockResolvedValue({ items: [], nextCursor: null });
  });

  it("lista con el rol, los estados repetidos, las fechas YYYY-MM-DD y el cursor", async () => {
    await transactionsClient.list({
      role: "sender",
      status: ["disputed", "refunded"],
      from: "2026-10-01",
      to: "2026-10-14",
      cursor: "abc",
      limit: 20,
    });

    expect(mockGet).toHaveBeenCalledWith("/payments/transactions", {
      role: "sender",
      status: ["disputed", "refunded"],
      from: "2026-10-01",
      to: "2026-10-14",
      cursor: "abc",
      limit: 20,
    });
  });

  it("sin estados elegidos no manda el parámetro status", async () => {
    await transactionsClient.list({ role: "carrier", status: [] });
    expect(mockGet).toHaveBeenCalledWith("/payments/transactions", { role: "carrier", status: undefined });
  });

  it("el detalle pide el id con el rol", async () => {
    await transactionsClient.getById("tx-9", "carrier");
    expect(mockGet).toHaveBeenCalledWith("/payments/transactions/tx-9", { role: "carrier" });
  });
});
