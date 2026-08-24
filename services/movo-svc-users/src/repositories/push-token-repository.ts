import { Prisma, PushPlatform as PrismaPushPlatform } from "../generated/prisma/client";
import { PushToken, PushPlatform, parsePushPlatform } from "../models/push-token";

export interface UpsertPushTokenInput {
  userId: string;
  deviceId: string;
  expoPushToken: string;
  platform: PushPlatform;
}

export interface PushTokenRepository {
  /** AC1/AC2: upsert por `(user_id, device_id)` -- un dispositivo tiene un solo token
   * vigente por usuario, permite multi-dispositivo. Atómico vía `db.pushToken.upsert`,
   * sin lógica manual de "buscar y luego crear o actualizar". */
  upsert(input: UpsertPushTokenInput): Promise<PushToken>;
  /** AC3: idempotente -- sin fila previa, `deleteMany` no tira, solo no borra nada. */
  deleteByDeviceId(userId: string, deviceId: string): Promise<void>;
  /** AC6: todos los tokens de un usuario, para el endpoint interno de envío. */
  findAllByUserId(userId: string): Promise<PushToken[]>;
  /** MOVO-134: baja de cuenta -- borra todos los dispositivos registrados del usuario, no solo uno. */
  deleteAllByUserId(userId: string): Promise<void>;
}

type PushTokenRow = Prisma.PushTokenGetPayload<Record<string, never>>;

/** Mismo criterio que `toDomainUser`/`toDomainKycVerification`: campo por campo, no
 * spread, para que agregar una columna rompa en compilación. */
function toDomainPushToken(row: PushTokenRow): PushToken {
  return {
    id: row.id,
    userId: row.userId,
    expoPushToken: row.expoPushToken,
    deviceId: row.deviceId,
    platform: parsePushPlatform(row.platform),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// `Prisma.TransactionClient` (no `PrismaClient`) a propósito, mismo criterio que
// `user-repository.ts`: MOVO-134 necesita pasarle el cliente transaccional de
// `db.$transaction(async (tx) => ...)` para que el borrado de push tokens participe
// de la misma transacción atómica que la anonimización del usuario.
export function createPushTokenRepository(db: Prisma.TransactionClient): PushTokenRepository {
  return {
    async upsert(input: UpsertPushTokenInput): Promise<PushToken> {
      const row = await db.pushToken.upsert({
        where: { userId_deviceId: { userId: input.userId, deviceId: input.deviceId } },
        create: {
          userId: input.userId,
          deviceId: input.deviceId,
          expoPushToken: input.expoPushToken,
          platform: input.platform as PrismaPushPlatform,
        },
        update: {
          expoPushToken: input.expoPushToken,
          platform: input.platform as PrismaPushPlatform,
        },
      });
      return toDomainPushToken(row);
    },

    async deleteByDeviceId(userId: string, deviceId: string): Promise<void> {
      await db.pushToken.deleteMany({ where: { userId, deviceId } });
    },

    async findAllByUserId(userId: string): Promise<PushToken[]> {
      const rows = await db.pushToken.findMany({ where: { userId } });
      return rows.map(toDomainPushToken);
    },

    async deleteAllByUserId(userId: string): Promise<void> {
      await db.pushToken.deleteMany({ where: { userId } });
    },
  };
}
