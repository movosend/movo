import { CarrierKycStatusResponse, KycStatus, PublicProfile } from "@movo/shared";
import { DeviceKey, UsersClient } from "../src/adapters/users-client";

/**
 * Fake de `UsersClient` para tests — evita depender de un `movo-svc-users` real
 * levantado (mismo criterio que `smsProvider`/`diditClient` en movo-svc-users).
 * `profiles` mapea `userId -> PublicProfile | undefined` (ausente = 404 real).
 * `deviceKeys` (MOVO-158) mapea `userId -> DeviceKey | undefined` (ausente = 404
 * `DEVICE_KEY_NOT_FOUND` real de svc-users, MOVO-157) — opcional, default vacío, los
 * tests que no ejercitan el handshake no necesitan tocarlo.
 * `blocks` (MOVO-175) es una lista de pares `[blockerId, blockedId]`; el fake resuelve
 * la simetría igual que svc-users (unión de las dos direcciones).
 * `kycStatuses` (MOVO-116) pisa por usuario lo que devuelve `findKycStatus`. Sin
 * override, la identidad sale de `profile.isVerified` (mismo dato en svc-users) y la
 * licencia es `approved`; un usuario que no está en `profiles` (muchos fixtures no
 * registran al transportista) cuenta como transportista habilitado. Así los tests
 * existentes siguen pasando el bloqueo de ADR-036 sin tocarlos.
 */
export function createFakeUsersClient(
  profiles: Record<string, PublicProfile>,
  deviceKeys: Record<string, DeviceKey> = {},
  blocks: Array<[string, string]> = [],
  kycStatuses: Record<string, Partial<CarrierKycStatusResponse>> = {},
  /** MOVO-210: email de cuenta por userId; ausente = `<userId>@movo.test`. */
  emails: Record<string, string> = {}
): UsersClient {
  return {
    async findAccountEmail(userId: string): Promise<string | null> {
      return emails[userId] ?? `${userId}@movo.test`;
    },
    async findKycStatus(userId: string): Promise<CarrierKycStatusResponse | null> {
      const profile = profiles[userId];
      const override = kycStatuses[userId];
      return {
        kycStatusIdentity: profile?.isVerified === false ? KycStatus.NOT_STARTED : KycStatus.APPROVED,
        kycStatusLicense: KycStatus.APPROVED,
        ...override,
      };
    },
    async listBlockRelatedUserIds(userId: string): Promise<string[]> {
      const ids = new Set<string>();
      for (const [blocker, blocked] of blocks) {
        if (blocker === userId) ids.add(blocked);
        if (blocked === userId) ids.add(blocker);
      }
      return [...ids];
    },
    async findPublicProfile(userId: string): Promise<PublicProfile | null> {
      return profiles[userId] ?? null;
    },
    async findDeviceKey(userId: string): Promise<DeviceKey | null> {
      return deviceKeys[userId] ?? null;
    },
  };
}

export function fakePublicProfile(overrides: Partial<PublicProfile> & { id: string }): PublicProfile {
  return {
    fullName: "Receptor de Prueba",
    photoUrl: null,
    isVerified: true,
    badges: ["kyc_verified"],
    transactionCounts: { asSender: 0, asCarrier: 0 },
    reputationScore: null,
    // MOVO-152: campos nuevos de PublicProfile -- este servicio no ejercita reputación
    // real (eso vive en svc-users), así que el fake queda en el mismo estado "sin
    // datos" que ya usaban reputationScore/transactionCounts arriba.
    ratingCount: 0,
    isNewProfile: true,
    asSender: {
      reputationScore: null,
      ratingCount: 0,
      isNewProfile: true,
      usageStats: { delivered: 0, cancelled: 0, avgPackageWeightKg: null },
    },
    asCarrier: {
      reputationScore: null,
      ratingCount: 0,
      isNewProfile: true,
      usageStats: { delivered: 0, cancelled: 0, avgPackageWeightKg: null },
    },
    recentRatingComments: [],
    // MOVO-170: campos nuevos de PublicProfile -- mismo criterio que arriba, este
    // servicio no ejercita ninguno de los tres de verdad.
    memberSince: new Date("2030-01-01T00:00:00.000Z").toISOString(),
    phoneVerified: false,
    emailVerified: false,
    // MOVO-171: idem, sin bio real en este fake.
    bio: null,
    ...overrides,
  };
}
