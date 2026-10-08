import { PrismaClient } from "../generated/prisma/client";
import type { CarrierMpAccount } from "../generated/prisma/client";

export type { CarrierMpAccount };

export interface LinkedAccountData {
  mpUserId: string;
  email: string | null;
  nickname: string | null;
  accessToken: string;
  refreshToken: string;
  publicKey: string;
  scope: string | null;
  tokenExpiresAt: Date;
}

/** Esa cuenta de MP ya está vinculada (activa) a otro usuario de Movo. */
export class MpAccountAlreadyLinkedError extends Error {
  constructor() {
    super("La cuenta de Mercado Pago ya está vinculada a otro usuario");
    this.name = "MpAccountAlreadyLinkedError";
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export interface CarrierMpAccountRepository {
  findByUserId(userId: string): Promise<CarrierMpAccount | null>;
  /**
   * Vincula (o re-vincula) la cuenta del usuario: pisa tokens y datos, y limpia
   * `revokedAt`/`unlinkedAt`. Tira `MpAccountAlreadyLinkedError` si esa cuenta de MP
   * está activa en otro usuario.
   */
  upsertLinked(userId: string, data: LinkedAccountData, now: Date): Promise<CarrierMpAccount>;
  /** Idempotente: sin fila, o ya desvinculada, no hace nada. */
  unlink(userId: string, now: Date): Promise<void>;
}

export function createCarrierMpAccountRepository(db: PrismaClient): CarrierMpAccountRepository {
  const upsert = (userId: string, data: LinkedAccountData, now: Date) => {
    const fields = { ...data, connectedAt: now, revokedAt: null, unlinkedAt: null };
    return db.carrierMpAccount.upsert({
      where: { userId },
      create: { userId, ...fields },
      update: fields,
    });
  };

  return {
    findByUserId(userId) {
      return db.carrierMpAccount.findUnique({ where: { userId } });
    },

    async upsertLinked(userId, data, now) {
      try {
        return await upsert(userId, data, now);
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        // El P2002 puede venir del índice parcial de `mp_user_id` o de una carrera
        // contra otro callback del mismo usuario sobre `user_id` (el upsert de Prisma
        // no es un ON CONFLICT atómico). Se distingue mirando la base, no el nombre del
        // constraint en el error, cuya forma cambia con el driver adapter.
        const holder = await db.carrierMpAccount.findFirst({
          where: { mpUserId: data.mpUserId, revokedAt: null, unlinkedAt: null, NOT: { userId } },
          select: { id: true },
        });
        if (holder) throw new MpAccountAlreadyLinkedError();
        return upsert(userId, data, now);
      }
    },

    async unlink(userId, now) {
      await db.carrierMpAccount.updateMany({
        where: { userId, unlinkedAt: null },
        data: { unlinkedAt: now, accessToken: null, refreshToken: null },
      });
    },
  };
}
