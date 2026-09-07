import { PublicProfile } from "@movo/shared";
import { DeviceKey, UsersClient } from "../src/adapters/users-client";

/**
 * Fake de `UsersClient` para tests — evita depender de un `movo-svc-users` real
 * levantado (mismo criterio que `smsProvider`/`diditClient` en movo-svc-users).
 * `profiles` mapea `userId -> PublicProfile | undefined` (ausente = 404 real).
 * `deviceKeys` (MOVO-158) mapea `userId -> DeviceKey | undefined` (ausente = 404
 * `DEVICE_KEY_NOT_FOUND` real de svc-users, MOVO-157) — opcional, default vacío, los
 * tests que no ejercitan el handshake no necesitan tocarlo.
 */
export function createFakeUsersClient(
  profiles: Record<string, PublicProfile>,
  deviceKeys: Record<string, DeviceKey> = {}
): UsersClient {
  return {
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
