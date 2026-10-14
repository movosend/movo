import { ApiError } from "@movo/shared/dist/errors/api-error";
import type { SavedCard } from "@movo/shared/dist/types/saved-card";
import { CardTokenError } from "../src/lib/mp-card-tokenizer";
import {
  cardLabel,
  cardMeta,
  cardSaveError,
  cardTitle,
  deleteCardBody,
  deleteCardTitle,
  hasUsableCard,
  isCardExpired,
  nextDefaultAfterDelete,
  renamedCardToast,
  savedCardToast,
  shortBankName,
  sortSavedCards,
} from "../src/lib/saved-cards";

const NOW = new Date(2026, 9, 14); // 14/10/2026

function card(overrides: Partial<SavedCard> = {}): SavedCard {
  return {
    id: "c1",
    mpCardId: "mp1",
    alias: null,
    brand: "visa",
    last4: "4242",
    expMonth: 11,
    expYear: 2029,
    issuerName: "Banco Galicia",
    paymentType: "credit_card",
    isDefault: false,
    createdAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("saved-cards (MOVO-101)", () => {
  it("sin nombre de referencia el título es la marca con los últimos 4 (AC2)", () => {
    expect(cardTitle(card())).toBe("Visa •••• 4242");
    expect(cardTitle(card({ brand: "debmaster" }))).toBe("Mastercard •••• 4242");
    expect(cardLabel(card())).toBe("Visa •••• 4242");
    expect(cardLabel(card({ alias: "Visa del trabajo" }))).toBe("Visa del trabajo");
  });

  it("meta con banco corto, tipo y vencimiento; sin banco en Amex", () => {
    expect(cardMeta(card(), NOW)).toBe("Galicia · Crédito · Vence 11/29");
    expect(cardMeta(card({ paymentType: "debit_card", issuerName: null }), NOW)).toBe("Débito · Vence 11/29");
    expect(cardMeta(card({ brand: "amex", issuerName: "American Express" }), NOW)).toBe("Crédito · Vence 11/29");
    expect(cardMeta(card({ expMonth: 8, expYear: 2026 }), NOW)).toBe("Galicia · Crédito · Venció 08/26");
  });

  it("una tarjeta vale hasta el último día de su mes", () => {
    expect(isCardExpired(card({ expMonth: 10, expYear: 2026 }), NOW)).toBe(false);
    expect(isCardExpired(card({ expMonth: 9, expYear: 2026 }), NOW)).toBe(true);
    expect(isCardExpired(card({ expMonth: 1, expYear: 2027 }), NOW)).toBe(false);
  });

  it("acorta el nombre del banco", () => {
    expect(shortBankName("Banco Galicia")).toBe("Galicia");
    expect(shortBankName("Banco de Córdoba")).toBe("Córdoba");
    expect(shortBankName("Santander")).toBe("Santander");
  });

  it("ordena la predeterminada primero y las vencidas al final", () => {
    const expired = card({ id: "old", expYear: 2020 });
    const def = card({ id: "def", isDefault: true });
    const other = card({ id: "other" });
    expect(sortSavedCards([expired, other, def], NOW).map((c) => c.id)).toEqual(["def", "other", "old"]);
    expect(hasUsableCard([expired], NOW)).toBe(false);
  });

  it("la siguiente predeterminada es la más reciente, como en el backend", () => {
    const def = card({ id: "def", isDefault: true, createdAt: "2026-10-01T00:00:00Z" });
    const older = card({ id: "older", createdAt: "2026-09-01T00:00:00Z" });
    const newer = card({ id: "newer", alias: "Personal", createdAt: "2026-10-10T00:00:00Z" });
    expect(nextDefaultAfterDelete([def, older, newer], def)?.id).toBe("newer");
    expect(deleteCardBody([def, older, newer], def, NOW)).toBe(
      "Es tu tarjeta predeterminada. Vamos a usar Personal en su lugar.",
    );
    expect(deleteCardBody([def], def, NOW)).toContain("Es tu única tarjeta vigente");
    expect(deleteCardBody([def, older], older, NOW)).toContain("La sacamos de tus medios de pago");
  });

  it("textos de eliminar, guardar y renombrar", () => {
    expect(deleteCardTitle(card({ alias: "Personal" }))).toBe('¿Eliminar "Personal"?');
    expect(deleteCardTitle(card())).toBe("¿Eliminar Visa •••• 4242?");
    expect(savedCardToast(card({ alias: "Gastos", isDefault: true }))).toBe('Guardamos "Gastos". Es tu predeterminada.');
    expect(savedCardToast(card())).toBe("Guardamos tu Visa •••• 4242.");
    expect(renamedCardToast(card())).toBe("Le sacaste el nombre a tu Visa •••• 4242.");
  });

  it("traduce el rechazo de MP y lleva al paso del dato a corregir (AC4)", () => {
    expect(cardSaveError(new CardTokenError({ reason: "invalid_security_code", field: "security_code" }))).toEqual({
      message: "El código de seguridad no es válido. Revisalo en el dorso de la tarjeta.",
      step: 2,
    });
    expect(cardSaveError(new CardTokenError({ reason: "invalid_number", field: "number" })).step).toBe(1);
    expect(cardSaveError(new ApiError(422, "CARD_SAVE_REJECTED", "x"))).toEqual({
      message: "Tu banco no aprobó la tarjeta. Revisá los datos o probá con otra. No se cobró nada.",
      step: null,
    });
  });
});
