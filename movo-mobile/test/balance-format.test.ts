import { formatBalanceAmountInput, parseBalanceAmountInput } from "../src/lib/balance-format";

describe("monto de pago de saldo (MOVO-315)", () => {
  it("agrupa los miles mientras se escribe y descarta lo que no es dígito", () => {
    expect(formatBalanceAmountInput("2500")).toBe("2.500");
    expect(formatBalanceAmountInput("$ 1.2a34")).toBe("1.234");
    expect(formatBalanceAmountInput("0050")).toBe("50");
    expect(formatBalanceAmountInput("")).toBe("");
  });

  it("lee el monto con punto de miles como pesos enteros", () => {
    expect(parseBalanceAmountInput("2.500")).toBe(2500);
    expect(parseBalanceAmountInput("")).toBeNaN();
  });
});
