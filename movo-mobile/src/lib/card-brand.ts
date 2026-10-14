export type CardBrandKey = "visa" | "master" | "amex";

/** `payment_method.id` de MP (`visa`, `debvisa`, `master`, `debmaster`, `amex`) a una marca con logo. */
export function cardBrandKey(brand: string | null | undefined): CardBrandKey | null {
  if (!brand) return null;
  const b = brand.toLowerCase();
  if (b.includes("visa")) return "visa";
  if (b.includes("master")) return "master";
  if (b === "amex" || b.includes("american")) return "amex";
  return null;
}

/** Marca por el primer dígito, mientras MP no respondió el BIN (el preview no espera a la red). */
export function cardBrandFromNumber(cardNumber: string): CardBrandKey | null {
  if (cardNumber.startsWith("4")) return "visa";
  if (cardNumber.startsWith("5") || cardNumber.startsWith("2")) return "master";
  if (cardNumber.startsWith("34") || cardNumber.startsWith("37")) return "amex";
  return null;
}
