/**
 * Sanciones de cuenta (MOVO-296). La tabla `users.account_sanctions` es el historial; en
 * `User.status`/`bannedUntil` queda la caché de la sanción vigente. Se agregan valores al
 * final, nunca se renombra uno existente.
 */

/** `suspension` bloquea las operaciones (con fin o indefinida); `disable` es permanente y
 * corta el login. */
export type AccountSanctionType = "suspension" | "disable";

/** Por qué se cerró una sanción en el historial. */
export type AccountSanctionClosedCause = "lifted" | "replaced" | "escalated" | "expired";

/** Estado de la cuenta que ve cualquier usuario en un perfil público, sin motivo ni plazo. */
export type PublicAccountStatus = "active" | "suspended" | "disabled";

/** Una fila del historial. `internalNote` es solo para el panel: nunca viaja a la app. */
export interface AccountSanction {
  id: string;
  userId: string;
  type: AccountSanctionType;
  /** Visible para el usuario sancionado. */
  reason: string;
  internalNote: string | null;
  startedAt: string;
  /** `null` = suspensión indefinida o inhabilitación permanente. */
  endsAt: string | null;
  appliedBy: string;
  /** `null` mientras la sanción está vigente. */
  liftedAt: string | null;
  /** `null` si la cerró el sistema (vencimiento) o sigue vigente. */
  liftedBy: string | null;
  liftReason: string | null;
  closedCause: AccountSanctionClosedCause | null;
}

export interface ApplyAccountSanctionRequest {
  type: AccountSanctionType;
  reason: string;
  internalNote?: string;
  /** ISO. Solo para `suspension`; sin fin es indefinida. */
  endsAt?: string;
}

export interface LiftAccountSanctionRequest {
  reason: string;
}

/** Largo máximo del motivo y de la nota interna (mismo criterio que `ADMIN_ACTION_REASON_MAX_LENGTH`). */
export const ACCOUNT_SANCTION_REASON_MAX_LENGTH = 500;
export const ACCOUNT_SANCTION_NOTE_MAX_LENGTH = 1000;

/**
 * Marca en Redis que lee el gateway (MOVO-298): una clave por usuario con el tipo de
 * restricción. Sin clave, la cuenta no está restringida. Redis no es la fuente de verdad:
 * `svc-users` la reescribe al arrancar y en cada barrido.
 */
export type AccountRestrictionMark = "suspended" | "disabled";

export function accountRestrictionKey(userId: string): string {
  return `account:restriction:${userId}`;
}
