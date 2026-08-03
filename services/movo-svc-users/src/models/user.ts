import { UserRole, KycStatus } from "@movo/shared";

/**
 * Modelo de dominio de un usuario. Siempre en términos de `@movo/shared`
 * (nunca los literales de DB en español/mayúscula) — la traducción vive
 * en `user-repository.ts` (ver MOVO-87 / comentario en MOVO-67).
 *
 * **Uso interno solamente**: incluye `passwordHash`. NUNCA devolver este objeto
 * tal cual en una respuesta HTTP — usar `toPublicUser()` y devolver `PublicUser`.
 */
export interface User {
  id: string;
  email: string;
  phone: string;
  firstName: string;
  lastName: string;
  passwordHash: string;
  dni: string | null;
  phoneVerified: boolean;
  photoUrl: string | null;
  kycStatusIdentity: KycStatus;
  lastKycVerificationIdentityId: string | null;
  kycStatusLicense: KycStatus;
  lastKycVerificationLicenseId: string | null;
  isBanned: boolean;
  bannedUntil: Date | null;
  roles: UserRole[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Proyección de `User` apta para salir por HTTP: es `User` sin `passwordHash`.
 * Definida con `Omit` a propósito — si mañana se agrega un campo sensible nuevo
 * a `User`, aparece acá automáticamente y hay que excluirlo explícitamente.
 */
export type PublicUser = Omit<User, "passwordHash">;

/**
 * Único puente permitido de `User` (interno) a lo que se serializa al cliente.
 * `toPublicUser` se construye campo por campo y no con spread: si se agrega una
 * propiedad a `User`, TypeScript rompe acá y obliga a decidir explícitamente si
 * es pública o no, en vez de filtrarla por defecto.
 */
export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    firstName: user.firstName,
    lastName: user.lastName,
    dni: user.dni,
    phoneVerified: user.phoneVerified,
    photoUrl: user.photoUrl,
    kycStatusIdentity: user.kycStatusIdentity,
    lastKycVerificationIdentityId: user.lastKycVerificationIdentityId,
    kycStatusLicense: user.kycStatusLicense,
    lastKycVerificationLicenseId: user.lastKycVerificationLicenseId,
    isBanned: user.isBanned,
    bannedUntil: user.bannedUntil,
    roles: user.roles,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export interface CreateUserInput {
  email: string;
  phone: string;
  firstName: string;
  lastName: string;
  passwordHash: string;
  dni?: string;
  roles: UserRole[];
}

/** Fila cruda de `users.users`, tal como la devuelve `pg` (snake_case). */
export interface UserRow {
  id: string;
  email: string;
  phone: string;
  first_name: string;
  last_name: string;
  password_hash: string;
  dni: string | null;
  phone_verified: boolean;
  photo_url: string | null;
  kyc_status_identity: string;
  last_kyc_verification_identity_id: string | null;
  kyc_status_license: string;
  last_kyc_verification_license_id: string | null;
  is_banned: boolean;
  banned_until: Date | null;
  created_at: Date;
  updated_at: Date;
}

// Mapeo explícito (no toUpperCase()/toLowerCase() implícito): si el texto del
// enum de DB cambia algún día, esto rompe en tiempo de compilación/test en
// vez de silenciosamente desalinearse.
const ROLE_TO_DB: Record<UserRole, string> = {
  [UserRole.SENDER]: "emisor",
  [UserRole.CARRIER]: "transportista",
  [UserRole.ADMIN]: "admin",
};

const ROLE_FROM_DB: Record<string, UserRole> = {
  emisor: UserRole.SENDER,
  transportista: UserRole.CARRIER,
  admin: UserRole.ADMIN,
};

const KYC_STATUS_TO_DB: Record<KycStatus, string> = {
  [KycStatus.NOT_STARTED]: "NOT_STARTED",
  [KycStatus.PENDING]: "PENDING",
  [KycStatus.APPROVED]: "APPROVED",
  [KycStatus.REJECTED]: "REJECTED",
  [KycStatus.EXPIRED]: "EXPIRED",
};

const KYC_STATUS_FROM_DB: Record<string, KycStatus> = {
  NOT_STARTED: KycStatus.NOT_STARTED,
  PENDING: KycStatus.PENDING,
  APPROVED: KycStatus.APPROVED,
  REJECTED: KycStatus.REJECTED,
  EXPIRED: KycStatus.EXPIRED,
};

/**
 * Un valor leído de una columna enum de la DB no tiene equivalente en
 * `@movo/shared`. Es un problema de integridad/drift de schema (alguien agregó
 * un valor al enum de Postgres sin agregarlo al dominio), no un fallo
 * transitorio: se distingue por tipo para que el caller pueda loguearlo y
 * alertar en vez de reintentar como si fuera un error de conexión.
 */
export class InvalidEnumValueError extends Error {
  constructor(
    public readonly column: string,
    public readonly value: string,
  ) {
    super(`Valor inesperado '${value}' en la columna '${column}': no existe en @movo/shared`);
    this.name = "InvalidEnumValueError";
  }
}

export function roleToDb(role: UserRole): string {
  const value = ROLE_TO_DB[role];
  if (!value) {
    // A diferencia de InvalidEnumValueError, esto es un bug de código (un
    // UserRole nuevo sin entrada en la tabla), no datos corruptos en la DB.
    throw new Error(`Rol de usuario sin mapeo a DB: ${role}`);
  }
  return value;
}

export function roleFromDb(value: string): UserRole {
  const role = ROLE_FROM_DB[value];
  if (!role) {
    throw new InvalidEnumValueError("user_roles.role", value);
  }
  return role;
}

export function kycStatusToDb(status: KycStatus): string {
  const value = KYC_STATUS_TO_DB[status];
  if (!value) {
    throw new Error(`KycStatus sin mapeo a DB: ${status}`);
  }
  return value;
}

/**
 * `column` se pide explícito porque el mismo enum respalda dos columnas
 * (`kyc_status_identity` y `kyc_status_license`): sin eso, el error no dice
 * cuál de las dos trajo el valor raro.
 */
export function kycStatusFromDb(value: string, column: string): KycStatus {
  const status = KYC_STATUS_FROM_DB[value];
  if (!status) {
    throw new InvalidEnumValueError(column, value);
  }
  return status;
}

export function mapRowToUser(row: UserRow, roles: string[]): User {
  return {
    id: row.id,
    email: row.email,
    phone: row.phone,
    firstName: row.first_name,
    lastName: row.last_name,
    passwordHash: row.password_hash,
    dni: row.dni,
    phoneVerified: row.phone_verified,
    photoUrl: row.photo_url,
    kycStatusIdentity: kycStatusFromDb(row.kyc_status_identity, "kyc_status_identity"),
    lastKycVerificationIdentityId: row.last_kyc_verification_identity_id,
    kycStatusLicense: kycStatusFromDb(row.kyc_status_license, "kyc_status_license"),
    lastKycVerificationLicenseId: row.last_kyc_verification_license_id,
    isBanned: row.is_banned,
    bannedUntil: row.banned_until,
    roles: roles.map(roleFromDb),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Violación de unicidad (email o phone ya registrados) traducida desde el `23505` de Postgres. */
export class UserConflictError extends Error {
  constructor(public readonly field: "email" | "phone") {
    super(`Ya existe un usuario con ese ${field}`);
    this.name = "UserConflictError";
  }
}
