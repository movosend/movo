import type { Pill } from "@/lib/users/format"

/** Estados de Didit (sesión y cada verificación) a texto y tono del panel. Lo desconocido se muestra tal cual, en neutro. */
export function diditStatusPill(status: string | null): Pill | null {
  if (!status) return null
  switch (status) {
    case "Approved":
      return { label: "Aprobado", tone: "success" }
    case "Declined":
      return { label: "Rechazado", tone: "danger" }
    case "In Review":
      return { label: "En revisión", tone: "warning" }
    case "Expired":
    case "Abandoned":
    case "Kyc Expired":
      return { label: "Vencido", tone: "neutral" }
    case "Not Finished":
    case "In Progress":
    case "Not Started":
      return { label: "Sin terminar", tone: "neutral" }
    default:
      return { label: status, tone: "neutral" }
  }
}

const DOCUMENT_TYPE: Record<string, string> = {
  Passport: "Pasaporte",
  "Identity Card": "Documento de identidad",
  "Driver's License": "Licencia de conducir",
  "Residence Permit": "Permiso de residencia",
}
export const documentTypeLabel = (type: string | null): string | null =>
  type ? (DOCUMENT_TYPE[type] ?? type) : null

const GENDER: Record<string, string> = {
  M: "Masculino",
  F: "Femenino",
  U: "No especificado",
}
export const genderLabel = (gender: string | null): string | null =>
  gender ? (GENDER[gender.toUpperCase()] ?? gender) : null

const MARITAL: Record<string, string> = {
  SINGLE: "Soltero/a",
  MARRIED: "Casado/a",
  DIVORCED: "Divorciado/a",
  WIDOWED: "Viudo/a",
  SEPARATED: "Separado/a",
}
export const maritalStatusLabel = (status: string | null): string | null =>
  status ? (MARITAL[status.toUpperCase()] ?? status) : null

const METHOD: Record<string, string> = {
  PASSIVE: "Pasiva",
  ACTIVE_3D: "Activa 3D",
  FLASHING: "Con destellos",
}
export const livenessMethodLabel = (method: string | null): string | null =>
  method ? (METHOD[method.toUpperCase()] ?? method) : null

/** De dónde viene una alerta de Didit (el `feature` del warning). */
const FEATURE: Record<string, string> = {
  ID_VERIFICATION: "Documento",
  LIVENESS: "Prueba de vida",
  FACE_MATCH: "Coincidencia facial",
  AML: "AML",
  IP_ANALYSIS: "Dirección IP",
  PHONE: "Teléfono",
  EMAIL: "Email",
  NFC: "NFC",
  DATABASE_VALIDATION: "Base de datos",
  PROOF_OF_ADDRESS: "Domicilio",
  QUESTIONNAIRE: "Cuestionario",
}
export const warningFeatureLabel = (feature: string): string =>
  FEATURE[feature] ?? feature.replaceAll("_", " ").toLowerCase()

/** `97.4` → "97 %": las puntuaciones de Didit van de 0 a 100. */
export const formatScore = (score: number | null): string | null =>
  score === null ? null : `${Math.round(score)} %`

export const yesNo = (value: boolean | null): string | null =>
  value === null ? null : value ? "Sí" : "No"
