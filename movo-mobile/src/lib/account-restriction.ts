import type { OwnAccountSanction } from "@movo/shared/dist/types/account-sanctions";

/**
 * Cuenta suspendida o inhabilitada (MOVO-300, decisiones 2 y 5 de MOVO-36). La sanción vigente
 * viene en `PrivateProfile.activeSanction`; el gateway (MOVO-298) es quien bloquea de verdad,
 * esto es la parte de la app: copy, contacto y fechas.
 */

export const SUPPORT_EMAIL = "soporte@movosend.app";

/** "Contactar a soporte" queda deshabilitado hasta que exista Ayuda y soporte en la app. */
export const SUPPORT_UNAVAILABLE_NOTE = "No disponible hasta MOVO-324 (Ayuda y soporte).";

/** Argentina no tiene horario de verano desde 2009: offset fijo en vez de `Intl` con
 * `timeZone`, que Hermes no respeta en todas las versiones. */
const ARGENTINA_OFFSET_MS = -3 * 60 * 60 * 1000;

/** `25/10` en horario argentino, mismo criterio que el push de la sanción (`@movo/shared`). */
export function formatSanctionDate(iso: string): string {
  const local = new Date(new Date(iso).getTime() + ARGENTINA_OFFSET_MS);
  const day = String(local.getUTCDate()).padStart(2, "0");
  const month = String(local.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}`;
}

/** Suspensión que sigue vigente. Una vencida que el barrido de `svc-users` todavía no cerró
 * cuenta como levantada: la app no espera al barrido para sacar el aviso. */
export function isActiveSuspension(
  sanction: OwnAccountSanction | null | undefined,
  now: number = Date.now(),
): sanction is OwnAccountSanction {
  if (!sanction || sanction.type !== "suspension") return false;
  return sanction.endsAt === null || new Date(sanction.endsAt).getTime() > now;
}

/** "hasta el 25/10" o "por tiempo indefinido". */
export function suspensionPeriodText(sanction: OwnAccountSanction): string {
  return sanction.endsAt
    ? `hasta el ${formatSanctionDate(sanction.endsAt)}`
    : "por tiempo indefinido";
}

/** Lo que sigue funcionando: la suspensión nunca deja un paquete trabado (decisión 3 de MOVO-36). */
export const SUSPENDED_ALLOWED_ACTIONS = [
  "Ver tus envíos, viajes y chats",
  "Completar los envíos que ya tenés en curso (retiros, entregas y seguimiento)",
  "Pagar un envío ya asignado",
  "Cancelar envíos y viajes",
  "Calificar y reportar",
] as const;

/** Lo que bloquea el gateway (`403 ACCOUNT_SUSPENDED`, MOVO-298): todo lo que inicia algo nuevo. */
export const SUSPENDED_BLOCKED_ACTIONS = [
  "Publicar o cotizar envíos",
  "Hacer o editar ofertas",
  "Aceptar ofertas",
  "Declarar viajes",
  "Invitar a otro receptor",
] as const;

/** Acción que inicia algo nuevo, para el aviso junto al botón deshabilitado. */
export type SuspendedAction =
  | "publish"
  | "offer"
  | "editOffer"
  | "acceptOffer"
  | "declareTrip"
  | "inviteReceiver";

const ACTION_TEXT: Record<SuspendedAction, string> = {
  publish: "publicar envíos",
  offer: "hacer ofertas",
  editOffer: "editar ofertas",
  acceptOffer: "aceptar ofertas",
  declareTrip: "declarar viajes",
  inviteReceiver: "invitar a otro receptor",
};

/** "No podés hacer ofertas mientras tu cuenta esté suspendida (hasta el 25/10)." */
export function suspendedActionMessage(
  action: SuspendedAction,
  sanction: OwnAccountSanction,
): string {
  const period = sanction.endsAt
    ? ` (hasta el ${formatSanctionDate(sanction.endsAt)})`
    : "";
  return `No podés ${ACTION_TEXT[action]} mientras tu cuenta esté suspendida${period}.`;
}

/** `data.type` de los avisos de sanción de `svc-users` (MOVO-296). Los que se levantan o vencen
 * llevan al inicio, donde el aviso desaparece solo (`use-push-notifications.ts`). */
export const ACCOUNT_SANCTION_CLEARED_NOTIFICATION_TYPES: readonly string[] = [
  "account_sanction_lifted",
  "account_suspension_expired",
];
/** Inhabilitada: la sesión ya no sirve (el gateway rechaza todo), se abre aunque no haya sesión. */
export const ACCOUNT_DISABLED_NOTIFICATION_TYPE = "account_disabled";
export const ACCOUNT_SANCTION_NOTIFICATION_TYPES: readonly string[] = [
  "account_suspended",
  ACCOUNT_DISABLED_NOTIFICATION_TYPE,
  ...ACCOUNT_SANCTION_CLEARED_NOTIFICATION_TYPES,
];

/** `data.type` de una notificación, o `null`. */
export function notificationType(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const value = (data as Record<string, unknown>).type;
  return typeof value === "string" && value.length > 0 ? value : null;
}
