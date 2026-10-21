import type { AdminContactField } from "@movo/shared/src/types/admin-users"
import { formatPhone } from "./format"

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Minúsculas y sin espacios, como lo guarda `svc-users` (índice único sobre `LOWER(email)`). */
export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase()
  return email.length <= 254 && EMAIL.test(email) ? email : null
}

/**
 * Teléfono argentino a E.164 móvil (`+549` + área + número). Acepta `+54 9 351 612-4410`,
 * `351 612-4410` y `0351 612 4410`. Es solo para validar y mostrar "se guardará como": la
 * normalización que vale es la de `svc-users`, la misma del login.
 */
export function normalizeArPhone(raw: string): string | null {
  if (!/^[\d\s()+-]+$/.test(raw.trim())) return null
  let digits = raw.replace(/\D/g, "")
  if (digits.startsWith("54")) digits = digits.slice(2)
  if (digits.startsWith("9")) digits = digits.slice(1)
  if (digits.startsWith("0")) digits = digits.slice(1)
  return /^[1-3]\d{9}$/.test(digits) ? `+549${digits}` : null
}

export function normalizeContact(
  field: AdminContactField,
  raw: string
): string | null {
  return field === "email" ? normalizeEmail(raw) : normalizeArPhone(raw)
}

/** Cómo se muestra un valor de contacto en el diálogo. */
export const displayContact = (field: AdminContactField, value: string) =>
  field === "phone" ? formatPhone(value) : value
