import {
  KycStatus,
  type PrivateProfile,
  type ProfileBadge,
  type PublicProfile,
  type TransactionCounts,
} from "@movo/shared";
import { User, fullName } from "./user";

// Los tipos de wire contract (`ProfileBadge`, `TransactionCounts`, `PrivateProfile`,
// `PublicProfile`) viven en `@movo/shared` (MOVO-78, migrados desde este archivo) —
// movo-mobile los consume por subpath (`@movo/shared/dist/types/user-profile`) sin
// duplicarlos. Este módulo re-exporta los tipos para no romper a `users.service.ts`,
// y sigue siendo el único lugar con las funciones de mapeo `User` → proyección.
export type { ProfileBadge, TransactionCounts, PrivateProfile, PublicProfile };

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
    emailVerified: user.emailVerified,
    phone: user.phone,
    photoUrl: user.photoUrl,
    kycStatus: user.kycStatusIdentity,
    licenseKycStatus: user.kycStatusLicense,
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
