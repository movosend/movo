/**
 * MOVO-294 (review de PR #279): la bitácora es de solo agregar filas y sobrevive a la baja de la
 * cuenta (`anonymizeAndDelete` solo limpia `users`), así que no guarda un email o un teléfono
 * completos. Lo enmascarado alcanza para reconocer el dato al revisar un caso.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at);
  if (local.length <= 2) return `${"*".repeat(local.length)}${domain}`;
  return `${local[0]}${"*".repeat(local.length - 2)}${local[local.length - 1]}${domain}`;
}

/** `+5493511234567` → `•••• 4567`. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 4 ? `•••• ${digits.slice(-4)}` : "••••";
}

export function maskContact(field: "email" | "phone", value: string): string {
  return field === "email" ? maskEmail(value) : maskPhone(value);
}
