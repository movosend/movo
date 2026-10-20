export type Identifier = { email: string } | { phone: string }

/** Valida el campo según la pestaña elegida (email o teléfono argentino, formato de la app). */
export function parseIdentifier(
  method: string,
  value: string
): Identifier | null {
  if (method === "phone") {
    // +54 9 351 123-4567, (351) 123 4567, etc.: se dejan solo los dígitos.
    const phone = value.replace(/[\s().-]/g, "").replace(/^\+/, "")
    return /^(54)?9?\d{10}$/.test(phone) ? { phone } : null
  }
  const email = value.toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254
    ? { email }
    : null
}

/** Para mostrar a dónde salió un código sin exponer el dato completo. */
export function maskIdentifier(identifier: Identifier): string {
  if ("phone" in identifier) return `***${identifier.phone.slice(-4)}`
  const [name, domain] = identifier.email.split("@")
  return `${name?.[0] ?? ""}***@${domain}`
}
