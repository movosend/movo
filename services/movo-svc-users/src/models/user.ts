import { UserRole, KycStatus } from "@movo/shared";

/**
 * Modelo de dominio de un usuario. Siempre en términos de `@movo/shared`
 * (nunca los literales de DB en español/mayúscula) — la traducción vive
 * en `user-repository.ts` (ver MOVO-87 / comentario en MOVO-67).
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

export function roleToDb(role: UserRole): string {
  const value = ROLE_TO_DB[role];
  if (!value) {
    throw new Error(`Rol de usuario sin mapeo a DB: ${role}`);
  }
  return value;
}

export function roleFromDb(value: string): UserRole {
  const role = ROLE_FROM_DB[value];
  if (!role) {
    throw new Error(`Valor de rol de DB sin mapeo a UserRole: ${value}`);
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

export function kycStatusFromDb(value: string): KycStatus {
  const status = KYC_STATUS_FROM_DB[value];
  if (!status) {
    throw new Error(`Valor de kyc_status de DB sin mapeo a KycStatus: ${value}`);
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
    kycStatusIdentity: kycStatusFromDb(row.kyc_status_identity),
    lastKycVerificationIdentityId: row.last_kyc_verification_identity_id,
    kycStatusLicense: kycStatusFromDb(row.kyc_status_license),
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
