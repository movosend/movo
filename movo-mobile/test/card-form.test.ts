import {
  formatCardNumberInput,
  formatDniInput,
  formatExpiryInput,
  isExpiryValid,
  isStepValid,
  sanitizeHolderName,
  validateCardForm,
} from "../src/lib/card-form";

const NOW = new Date(2026, 9, 14);
const BASE = { num: "4075595716483764", exp: "1130", cvv: "123", name: "Julieta Ramos", dni: "36789012" };

describe("card-form (MOVO-101)", () => {
  it("valida cada paso como el prototipo", () => {
    const v = validateCardForm(BASE, null, NOW);
    expect(v).toEqual({ num: true, exp: true, cvv: true, name: true, dni: true });
    expect(isStepValid(1, validateCardForm({ ...BASE, num: "40755957" }, null, NOW))).toBe(false);
    expect(isStepValid(2, validateCardForm({ ...BASE, cvv: "12" }, null, NOW))).toBe(false);
    expect(isStepValid(3, validateCardForm({ ...BASE, dni: "123456" }, null, NOW))).toBe(false);
  });

  it("Amex: 15 dígitos y código de 4", () => {
    const amex = { ...BASE, num: "377798123456789", cvv: "1234" };
    expect(validateCardForm(amex, null, NOW)).toMatchObject({ num: true, cvv: true });
  });

  it("usa los largos que informa MP para el BIN", () => {
    const bin = {
      paymentMethodId: "cabal",
      paymentType: "debit_card",
      issuerName: null,
      cardNumberLength: 19,
      securityCodeLength: 3,
    };
    expect(validateCardForm(BASE, bin, NOW).num).toBe(false);
  });

  it("rechaza vencimientos pasados o inválidos", () => {
    expect(isExpiryValid("1026", NOW)).toBe(true);
    expect(isExpiryValid("0926", NOW)).toBe(false);
    expect(isExpiryValid("1330", NOW)).toBe(false);
    expect(isExpiryValid("113", NOW)).toBe(false);
  });

  it("formatea los campos", () => {
    expect(formatCardNumberInput("4517650612349921")).toBe("4517 6506 1234 9921");
    expect(formatExpiryInput("0331")).toBe("03/31");
    expect(formatExpiryInput("03")).toBe("03");
    expect(formatDniInput("36789012")).toBe("36.789.012");
    expect(sanitizeHolderName("Julieta R4mos!")).toBe("Julieta Rmos");
  });
});
