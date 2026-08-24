import { UserRole, KycStatus, AccountStatus } from "@movo/shared";

/**
 * Modelo de dominio de un usuario. Los enums de `users.users` están alineados
 * 1:1 con `UserRole`/`KycStatus`/`AccountStatus` de `@movo/shared` (MOVO-91, MOVO-92).
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
  /** MOVO-139: el usuario probó posesión del email vía OTP (`/users/me/email/verify/*`
   * o el paso 2 de cambio de email). Precondición de MOVO-64. */
  emailVerified: boolean;
  /** Solo auditoría: nunca se lee para decidir nada, el booleano de arriba es la fuente. */
  emailVerifiedAt: Date | null;
  photoUrl: string | null;
  kycStatusIdentity: KycStatus;
  kycStatusLicense: KycStatus;
  status: AccountStatus;
  bannedUntil: Date | null;
  birthdate: Date | null;
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
 * Única definición de cómo se compone el nombre visible de un usuario (review de
 * PR #55, tmvergara) — antes se armaba `${firstName} ${lastName}` suelto en
 * `user-profile.ts` (x2) y `auth.service.ts`.
 */
export function fullName(user: Pick<User, "firstName" | "lastName">): string {
  return `${user.firstName} ${user.lastName}`;
}

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
    emailVerified: user.emailVerified,
    emailVerifiedAt: user.emailVerifiedAt,
    photoUrl: user.photoUrl,
    kycStatusIdentity: user.kycStatusIdentity,
    kycStatusLicense: user.kycStatusLicense,
    status: user.status,
    bannedUntil: user.bannedUntil,
    birthdate: user.birthdate,
    roles: user.roles,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

/**
 * MOVO-73: primera dirección del usuario (tabla `users.address` del DER,
 * `docs/movo_der.dbml`, implementada recién en esta US). `label`/`isDefault`/
 * `country` no viajan del caller — el repositorio los hardcodea al crear (ver
 * `user-repository.ts#create`).
 */
export interface CreateUserAddressInput {
  street: string;
  number: string;
  floor?: string;
  city: string;
  province: string;
  zip: string;
  lat: number;
  long: number;
}

export interface CreateUserInput {
  email: string;
  phone: string;
  firstName: string;
  lastName: string;
  passwordHash: string;
  dni?: string;
  birthdate?: Date | null;
  roles: UserRole[];
  // MOVO-72: register() ahora exige phoneVerificationToken (MOVO-71) y lo consume antes
  // de crear la cuenta — el usuario se persiste ya con el teléfono verificado.
  phoneVerified: boolean;
  // MOVO-73: `POST /auth/register` exige `address` en el body (ver auth.schema.ts) —
  // requerido acá también, no opcional, porque `users.address.lat/long` son NOT NULL.
  address: CreateUserAddressInput;
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
  email_verified: boolean;
  email_verified_at: Date | null;
  photo_url: string | null;
  kyc_status_identity: string;
  kyc_status_license: string;
  status: string;
  banned_until: Date | null;
  birthdate: Date | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Un valor leído de una columna enum de la DB no tiene equivalente en
 * `@movo/shared`. Es drift de schema (alguien agregó un valor al enum de
 * Postgres sin agregarlo al dominio), no un fallo transitorio: se distingue por
 * tipo para que el caller pueda loguearlo y alertar en vez de reintentar como
 * si fuera un error de conexión.
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

const USER_ROLE_VALUES: ReadonlySet<string> = new Set(Object.values(UserRole));
const KYC_STATUS_VALUES: ReadonlySet<string> = new Set(Object.values(KycStatus));
const ACCOUNT_STATUS_VALUES: ReadonlySet<string> = new Set(Object.values(AccountStatus));

export function parseUserRole(value: string): UserRole {
  if (!USER_ROLE_VALUES.has(value)) {
    throw new InvalidEnumValueError("user_roles.role", value);
  }
  return value as UserRole;
}

/**
 * `column` se pide explícito porque el mismo enum respalda dos columnas
 * (`kyc_status_identity` y `kyc_status_license`): sin eso, el error no dice
 * cuál de las dos trajo el valor raro.
 */
export function parseKycStatus(value: string, column: string): KycStatus {
  if (!KYC_STATUS_VALUES.has(value)) {
    throw new InvalidEnumValueError(column, value);
  }
  return value as KycStatus;
}

export function parseAccountStatus(value: string): AccountStatus {
  if (!ACCOUNT_STATUS_VALUES.has(value)) {
    throw new InvalidEnumValueError("status", value);
  }
  return value as AccountStatus;
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
    emailVerified: row.email_verified,
    emailVerifiedAt: row.email_verified_at,
    photoUrl: row.photo_url,
    kycStatusIdentity: parseKycStatus(row.kyc_status_identity, "kyc_status_identity"),
    kycStatusLicense: parseKycStatus(row.kyc_status_license, "kyc_status_license"),
    status: parseAccountStatus(row.status),
    bannedUntil: row.banned_until,
    birthdate: row.birthdate,
    roles: roles.map(parseUserRole),
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
