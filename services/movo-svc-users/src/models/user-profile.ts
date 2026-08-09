import { AccountStatus, KycStatus, UserRole } from "@movo/shared";
import { User, fullName } from "./user";

/**
 * Insignias calculadas desde el estado real del usuario (MOVO-77 AC5). Por ahora la
 * única posible es `"kyc_verified"`; MOVO-15 sumará `"license_verified"` cuando exista
 * verificación de licencia de conducir. En inglés a propósito (review de PR #55,
 * tmvergara): es un valor que el móvil matchea, y el resto de los enums de wire
 * contract (`UserRole`, `KycStatus`, `AccountStatus`) ya están en inglés.
 */
export type ProfileBadge = "kyc_verified" | "license_verified";

/**
 * Contadores de transacciones por rol. Sin tablas de envíos todavía (MOVO-25) — el
 * contrato queda fijo con ceros para que el móvil no necesite cambios cuando el dato
 * exista de verdad (AC6).
 */
export interface TransactionCounts {
  asSender: number;
  asCarrier: number;
}

/**
 * Perfil completo del usuario autenticado (`GET /users/me`, AC1). Interno del wire
 * contract de este endpoint — nunca se expone en la proyección pública.
 *
 * **No incluye `phoneVerified`/`dni`/`birthdate`** (review de PR #55, tmvergara):
 * AC1 no los pide, y quedan afuera a propósito hasta confirmar con quien implemente
 * MOVO-31 (editar datos personales) si hacen falta — sumarlos ahora es barato,
 * sumarlos después de fijado el contrato implica una segunda vuelta de backend +
 * release del móvil. Si se necesitan, van solo acá (nunca en `PublicProfile`: `dni`
 * y `birthdate` son datos personales sensibles, el mismo caso que AC3 previene por
 * construcción para el resto de los campos).
 */
export interface PrivateProfile {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string;
  photoUrl: string | null;
  kycStatus: KycStatus;
  accountStatus: AccountStatus;
  roles: UserRole[];
  badges: ProfileBadge[];
  transactionCounts: TransactionCounts;
  reputationScore: number | null;
}

/**
 * Proyección pública de cualquier usuario (`GET /users/:id`, AC2). Tipo separado a
 * propósito (no un `Omit`/flag sobre `PrivateProfile`, AC3): nunca puede tener
 * `email`/`phone`/`accountStatus` porque esos campos no existen en este tipo — si se
 * agrega un dato sensible a `PrivateProfile` a futuro, no aparece acá salvo que se
 * decida explícitamente sumarlo también a este tipo y a `toPublicProfile`.
 */
export interface PublicProfile {
  id: string;
  fullName: string;
  photoUrl: string | null;
  isVerified: boolean;
  badges: ProfileBadge[];
  transactionCounts: TransactionCounts;
  reputationScore: number | null;
}

function computeBadges(user: User): ProfileBadge[] {
  const badges: ProfileBadge[] = [];
  if (user.kycStatusIdentity === KycStatus.APPROVED) {
    badges.push("kyc_verified");
  }
  // TODO(MOVO-15): sumar "license_verified" cuando exista verificación de licencia.
  return badges;
}

// TODO(MOVO-25): reemplazar por conteos reales cuando exista la tabla de envíos.
function placeholderTransactionCounts(): TransactionCounts {
  return { asSender: 0, asCarrier: 0 };
}

/** Único puente permitido de `User` a la proyección privada (AC1). Campo por campo,
 * mismo criterio que `toPublicUser()` en `models/user.ts`: agregar un campo a `User`
 * no lo expone acá hasta decidirlo explícitamente. */
export function toPrivateProfile(user: User): PrivateProfile {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    fullName: fullName(user),
    email: user.email,
    phone: user.phone,
    photoUrl: user.photoUrl,
    kycStatus: user.kycStatusIdentity,
    accountStatus: user.status,
    roles: user.roles,
    badges: computeBadges(user),
    // TODO(MOVO-25): reemplazar por el score de reputación real.
    transactionCounts: placeholderTransactionCounts(),
    reputationScore: null,
  };
}

/** Único puente permitido de `User` a la proyección pública (AC2/AC3/AC4). */
export function toPublicProfile(user: User): PublicProfile {
  return {
    id: user.id,
    fullName: fullName(user),
    photoUrl: user.photoUrl,
    isVerified: user.kycStatusIdentity === KycStatus.APPROVED,
    badges: computeBadges(user),
    // TODO(MOVO-25): reemplazar por el score de reputación real.
    transactionCounts: placeholderTransactionCounts(),
    reputationScore: null,
  };
}
