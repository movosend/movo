/**
 * Rol de un usuario dentro de la plataforma.
 *
 * Provisorio: el DER (`Movo_DER_1.0.md`) no modela roles como un atributo
 * persistido en `User` — solo existe `isAdmin: boolean`, y "sender"/"carrier"
 * son roles contextuales por envío (FKs en `Shipment`), no una lista de roles
 * de cuenta. Se define acá como array porque un mismo usuario puede ser
 * emisor y transportista simultáneamente (ver MOVO-67). Pendiente de
 * confirmación por el equipo — ver comentario en MOVO-67 en Linear.
 */
export enum UserRole {
  SENDER = "sender",
  CARRIER = "carrier",
  ADMIN = "admin",
}

/**
 * Estado de verificación KYC de un usuario.
 *
 * Tomado directamente del DER (`User.kyc_status_identity` /
 * `kyc_status_license`). El DER modela dos estados de KYC por usuario
 * (identidad y licencia); `AccessTokenClaims.kycStatus` usa el de
 * identidad como el que gobierna autorización general — ver comentario
 * en MOVO-67 en Linear para el detalle de esta simplificación.
 */
export enum KycStatus {
  NOT_STARTED = "not_started",
  PENDING = "pending",
  APPROVED = "approved",
  REJECTED = "rejected",
  EXPIRED = "expired",
  // MOVO-72: estado intermedio de Didit.me ("In Review") que requiere revisión manual
  // antes de resolverse a approved/rejected — agregado al final, nunca se renombra un
  // valor existente (mismo criterio que ApiErrorCode).
  MANUAL_REVIEW = "manual_review",
}

/**
 * Estado de la cuenta de un usuario (MOVO-92).
 *
 * `status` de la entidad User: active | banned | deleted.
 */
export enum AccountStatus {
  ACTIVE = "active",
  BANNED = "banned",
  DELETED = "deleted",
}

/**
 * Motivo de un reporte de usuario (MOVO-175). Se agregan valores al final, nunca
 * se renombra uno existente (mismo criterio que `KycStatus`).
 */
export enum ReportReason {
  HARASSMENT = "harassment",
  NO_SHOW = "no_show",
  DAMAGED_PACKAGE = "damaged_package",
  PAYMENT_ISSUE = "payment_issue",
  OTHER = "other",
}

/** Estado de revisión de un reporte de usuario (MOVO-175). La revisión la hace un admin (fuera de alcance de MOVO-175). */
export enum ReportStatus {
  PENDING = "pending",
  REVIEWED = "reviewed",
  DISMISSED = "dismissed",
}

/** Información que el reportante sumó a su reporte pendiente (MOVO-175). Append-only. */
export interface UserReportEntry {
  id: string;
  details: string;
  /** ISO date. */
  createdAt: string;
}

/**
 * Reporte propio sobre otro usuario (MOVO-175): `GET /users/:id/report` y respuesta de
 * `POST /users/:id/report`. Nunca expone reportes de terceros.
 */
export interface UserReportSummary {
  id: string;
  reportedId: string;
  reason: ReportReason;
  details: string | null;
  status: ReportStatus;
  /** ISO date. */
  createdAt: string;
  /** Entradas sumadas después, de la más vieja a la más nueva. */
  entries: UserReportEntry[];
}

/**
 * Fila de `GET /users/me/blocked` (MOVO-175): usuarios que el caller bloqueó, del
 * más reciente al más viejo. Solo la dirección propia -- quién me bloqueó a mí no
 * se expone nunca.
 */
export interface BlockedUserSummary {
  id: string;
  fullName: string;
  photoUrl: string | null;
  /** ISO date del bloqueo. */
  blockedAt: string;
}
