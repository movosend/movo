import { UserRole, KycStatus } from "@movo/shared";

/**
 * Modelo de dominio de un usuario. Los enums de `users.users` están alineados
 * 1:1 con `UserRole`/`KycStatus` de `@movo/shared` (MOVO-91) — el literal de
 * DB y el valor de dominio son el mismo string, no hace falta traducir.
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
    kycStatusIdentity: row.kyc_status_identity as KycStatus,
    lastKycVerificationIdentityId: row.last_kyc_verification_identity_id,
    kycStatusLicense: row.kyc_status_license as KycStatus,
    lastKycVerificationLicenseId: row.last_kyc_verification_license_id,
    isBanned: row.is_banned,
    bannedUntil: row.banned_until,
    roles: roles as UserRole[],
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
