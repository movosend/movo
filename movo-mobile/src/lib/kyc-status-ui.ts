import { KycStatus } from "@movo/shared/dist/types/user";
import {
  Check,
  Clock,
  Hourglass,
  ShieldQuestion,
  TimerOff,
  X,
  type LucideIcon,
} from "lucide-react-native";

/**
 * Tono/ícono/label de estado de KYC, factorizado para que las 3 instancias donde se
 * muestra (banner de `home.tsx`, resultado de `kyc.tsx`, badge de perfil de MOVO-78)
 * queden consistentes entre sí en vez de 3 mapeos independientes que pueden divergir.
 *
 * Deliberadamente acotado a `KycStatus` puro — los `VerificationErrorType` del SDK de
 * Didit (`networkError`, `cameraAccessDenied`, etc., usados en `kyc.tsx#RESULT_BADGE`)
 * no son estados de KYC, son fallas del flujo de verificación en sí, y siguen
 * viviendo solo en `kyc.tsx`.
 */
export type KycStatusTone = "success" | "warning" | "danger" | "neutral";

const TONE_BY_STATUS: Record<KycStatus, KycStatusTone> = {
  [KycStatus.APPROVED]: "success",
  [KycStatus.PENDING]: "warning",
  [KycStatus.MANUAL_REVIEW]: "warning",
  [KycStatus.REJECTED]: "danger",
  [KycStatus.EXPIRED]: "danger",
  [KycStatus.NOT_STARTED]: "neutral",
};

const ICON_BY_STATUS: Record<KycStatus, LucideIcon> = {
  [KycStatus.APPROVED]: Check,
  [KycStatus.PENDING]: Clock,
  [KycStatus.MANUAL_REVIEW]: Hourglass,
  [KycStatus.REJECTED]: X,
  [KycStatus.EXPIRED]: TimerOff,
  [KycStatus.NOT_STARTED]: ShieldQuestion,
};

// Labels cortos para badges/chips — distintos de los textos largos de banner que ya
// tienen `home.tsx#KYC_BANNER_TEXT` y `kyc.tsx#RESULT_COPY`, esos no se tocan.
const LABEL_BY_STATUS: Record<KycStatus, string> = {
  [KycStatus.APPROVED]: "Verificado",
  [KycStatus.PENDING]: "Verificación en curso",
  [KycStatus.MANUAL_REVIEW]: "En revisión",
  [KycStatus.REJECTED]: "Rechazado",
  [KycStatus.EXPIRED]: "Verificación vencida",
  [KycStatus.NOT_STARTED]: "Sin verificar",
};

// Mismos hex que `kyc.tsx#BADGE_TONE_CLASS`/`BADGE_ICON_COLOR` — esas escalas
// (`danger`/`warning`/`success`) todavía no tienen paso dark en `global.css` (ver nota
// en CLAUDE.md), así que se mantienen como className/hex fijos en ambos temas.
export const KYC_TONE_BG_CLASS: Record<KycStatusTone, string> = {
  success: "bg-lime-500",
  danger: "bg-danger-100",
  warning: "bg-warning-100",
  neutral: "bg-bg-mute",
};

export const KYC_TONE_ICON_HEX: Record<"success" | "danger" | "warning", string> = {
  success: "#0A0A0B", // ink-950, sobre el relleno lime
  danger: "#C22F35", // danger-600
  warning: "#A97714", // warning-700
};

export function kycStatusTone(status: KycStatus): KycStatusTone {
  return TONE_BY_STATUS[status];
}

export function kycStatusIcon(status: KycStatus): LucideIcon {
  return ICON_BY_STATUS[status];
}

export function kycStatusLabel(status: KycStatus): string {
  return LABEL_BY_STATUS[status];
}
