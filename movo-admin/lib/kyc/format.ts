import type { AdminKycVerificationType } from "@movo/shared/src/types/admin-kyc"

export const KYC_TYPE_LABEL: Record<AdminKycVerificationType, string> = {
  identity: "Identidad",
  license: "Licencia",
}

/** `?type=` de la URL a un tipo válido; cualquier otra cosa es "todos". */
export function parseKycType(
  value: string | undefined
): AdminKycVerificationType | undefined {
  return value === "identity" || value === "license" ? value : undefined
}

/** "hace 3 días": cuánto lleva esperando un caso. Solo con cuenta de días enteros, sin horas. */
export function waitingLabel(iso: string, now = new Date()): string {
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return "hoy"
  return days === 1 ? "hace 1 día" : `hace ${days} días`
}

/** Si la espera ya es larga se resalta en la lista (un caso así lo está esperando una persona real). */
export const KYC_LONG_WAIT_DAYS = 3
export const isLongWait = (iso: string, now = new Date()): boolean =>
  (now.getTime() - new Date(iso).getTime()) / 86_400_000 >= KYC_LONG_WAIT_DAYS
