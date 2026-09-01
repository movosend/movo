import {
  KycStatus,
  type PrivateProfile,
  type ProfileBadge,
  type PublicProfile,
  type RecentRatingComment,
  type ReputationBreakdown,
  type TransactionCounts,
} from "@movo/shared";
import { User, fullName } from "./user";

// Los tipos de wire contract (`ProfileBadge`, `TransactionCounts`, `PrivateProfile`,
// `PublicProfile`) viven en `@movo/shared` (MOVO-78, migrados desde este archivo) —
// movo-mobile los consume por subpath (`@movo/shared/dist/types/user-profile`) sin
// duplicarlos. Este módulo re-exporta los tipos para no romper a `users.service.ts`,
// y sigue siendo el único lugar con las funciones de mapeo `User` → proyección.
export type { ProfileBadge, TransactionCounts, PrivateProfile, PublicProfile };

/** MOVO-152: fallback cuando `svc-shipments` no responde o el usuario no tiene
 * calificaciones (AC3/AC2) -- mismo shape que devolvería el motor de reputación real
 * para "sin datos", nunca un `0` (un cero es una nota pésima, no ausencia de datos). */
export const NO_REPUTATION: ReputationBreakdown = { reputationScore: null, ratingCount: 0, isNewProfile: true };
export const NO_TRANSACTION_COUNTS: TransactionCounts = { asSender: 0, asCarrier: 0 };

function computeBadges(user: User): ProfileBadge[] {
  const badges: ProfileBadge[] = [];
  if (user.kycStatusIdentity === KycStatus.APPROVED) {
    badges.push("kyc_verified");
  }
  if (user.kycStatusLicense === KycStatus.APPROVED) {
    badges.push("license_verified");
  }
  return badges;
}

/** Único puente permitido de `User` a la proyección privada (AC1). Campo por campo,
 * mismo criterio que `toPublicUser()` en `models/user.ts`: agregar un campo a `User`
 * no lo expone acá hasta decidirlo explícitamente.
 *
 * MOVO-152: `reputation`/`transactionCounts` ya vienen resueltos por el caller
 * (`users.service.ts#resolveReputationSummary`, cacheado y con fallback a
 * `NO_REPUTATION` si `svc-shipments` no respondió) -- esta función sigue siendo pura,
 * sin I/O. */
export function toPrivateProfile(
  user: User,
  reputation: ReputationBreakdown,
  transactionCounts: TransactionCounts
): PrivateProfile {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    fullName: fullName(user),
    email: user.email,
    emailVerified: user.emailVerified,
    phone: user.phone,
    dni: user.dni,
    phoneVerified: user.phoneVerified,
    photoUrl: user.photoUrl,
    kycStatus: user.kycStatusIdentity,
    licenseKycStatus: user.kycStatusLicense,
    accountStatus: user.status,
    roles: user.roles,
    badges: computeBadges(user),
    transactionCounts,
    reputationScore: reputation.reputationScore,
  };
}

/** Único puente permitido de `User` a la proyección pública (AC2/AC3/AC4).
 *
 * MOVO-152 AC2: `asSender`/`asCarrier`/`isNewProfile` viajan siempre (el mismo
 * `reputation` que ya trae `resolveReputationSummary`, sin I/O nueva acá).
 * `recentRatingComments` llega vacío desde `searchUsers` a propósito (composición
 * liviana, ver el comentario del tipo en `@movo/shared`) y poblado desde
 * `getPublicProfile` -- esta función no distingue los casos, solo mapea lo que el
 * caller ya resolvió. */
export function toPublicProfile(
  user: User,
  reputation: ReputationBreakdown & { asSender: ReputationBreakdown; asCarrier: ReputationBreakdown },
  transactionCounts: TransactionCounts,
  recentRatingComments: RecentRatingComment[]
): PublicProfile {
  return {
    id: user.id,
    fullName: fullName(user),
    photoUrl: user.photoUrl,
    isVerified: user.kycStatusIdentity === KycStatus.APPROVED,
    badges: computeBadges(user),
    transactionCounts,
    reputationScore: reputation.reputationScore,
    ratingCount: reputation.ratingCount,
    isNewProfile: reputation.isNewProfile,
    asSender: reputation.asSender,
    asCarrier: reputation.asCarrier,
    recentRatingComments,
  };
}
