import { Prisma } from "../generated/prisma/client";

/** Fila de `users.device_keys` (MOVO-157) — la clave PÚBLICA vigente del dispositivo
 * de un usuario, prerrequisito del handshake criptográfico de MOVO-6/MOVO-158. */
export interface DeviceKey {
  id: string;
  userId: string;
  publicKey: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DeviceKeyRepository {
  /** AC2/AC5: upsert por `user_id` (único) — registrar una clave nueva rota
   * implícitamente la anterior, nunca queda más de una fila vigente por usuario. */
  upsert(userId: string, publicKey: string): Promise<DeviceKey>;
  /** AC3/AC4: `null` si el usuario no tiene ninguna clave registrada todavía. */
  findByUserId(userId: string): Promise<DeviceKey | null>;
}

type DeviceKeyRow = Prisma.DeviceKeyGetPayload<Record<string, never>>;

/** Mismo criterio que `toDomainPushToken`/`toDomainUser`: campo por campo, no spread,
 * para que agregar una columna rompa en compilación en vez de filtrarse en silencio. */
function toDomainDeviceKey(row: DeviceKeyRow): DeviceKey {
  return {
    id: row.id,
    userId: row.userId,
    publicKey: row.publicKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createDeviceKeyRepository(db: Prisma.TransactionClient): DeviceKeyRepository {
  return {
    async upsert(userId: string, publicKey: string): Promise<DeviceKey> {
      const row = await db.deviceKey.upsert({
        where: { userId },
        create: { userId, publicKey },
        update: { publicKey },
      });
      return toDomainDeviceKey(row);
    },

    async findByUserId(userId: string): Promise<DeviceKey | null> {
      const row = await db.deviceKey.findUnique({ where: { userId } });
      return row ? toDomainDeviceKey(row) : null;
    },
  };
}
