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
}

/**
 * Estado de la cuenta de un usuario.
 *
 * Provisorio: el DER no define un enum de estado de cuenta — solo
 * `is_banned: boolean` + `banned_until: timestamp` en `User`. Se propone
 * este mapeo como punto de partida, pendiente de confirmación por el
 * equipo — ver comentario en MOVO-67 en Linear.
 */
export enum AccountStatus {
  ACTIVE = "active",
  BANNED_TEMPORARY = "banned_temporary",
  BANNED_PERMANENT = "banned_permanent",
}
