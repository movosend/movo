import { balanceEntryOrigin, balanceEntryTitle, formatBalanceAmountInput, formatBalanceArs, parseBalanceAmountInput } from "../src/lib/balance-format";

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

describe("formatBalanceArs y títulos de la lista de Saldo", () => {
  it("muestra enteros sin decimales y centavos siempre con dos dígitos", () => {
    expect(formatBalanceArs(5000)).toBe("$5.000");
    expect(formatBalanceArs(1742.5)).toBe("$1.742,50");
    expect(formatBalanceArs(6742.5)).toBe("$6.742,50");
  });

  it("saca el id interno que el backend pega al final de la etiqueta del envío", () => {
    const entry = { shipmentId: "s", destination: "Rivadavia 387", originLabel: "Envío a Rivadavia 387 #a8a0ed48", type: "cancellation_penalty" } as never;
    expect(balanceEntryOrigin(entry)).toBe("Envío a Rivadavia 387");
    expect(balanceEntryTitle(entry)).toBe("Envío a Rivadavia 387");
  });

  it("sin envío ni etiqueta el título es el tipo", () => {
    expect(balanceEntryTitle({ shipmentId: null, originLabel: null, type: "manual_adjustment" } as never)).toBe("Ajuste");
  });
});
