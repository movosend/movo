import { LIVE_HOLD_STATUSES } from "@movo/shared";
import { Prisma, PrismaClient } from "../generated/prisma/client";
import type { PayerCustomer, SavedCard } from "../generated/prisma/client";

export type { PayerCustomer, SavedCard };

export interface NewSavedCard {
  mpCardId: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  alias: string | null;
}

export type CreateSavedCardResult =
  | { kind: "created"; card: SavedCard }
  /** Ya había una tarjeta viva equivalente (mismo `mp_card_id`, o misma marca/últimos 4/vencimiento). */
  | { kind: "duplicate"; card: SavedCard }
  | { kind: "limit_reached" };

/** Ids del usuario que se borraron localmente al dar de baja la cuenta. */
export interface DeletedUserCards {
  mpCustomerId: string | null;
  cardCount: number;
}

export interface SavedCardRepository {
  findCustomer(userId: string): Promise<PayerCustomer | null>;
  /** Idempotente: dos altas concurrentes del primer customer terminan en la misma fila. */
  saveCustomer(userId: string, mpCustomerId: string): Promise<PayerCustomer>;
  /** Vivas del usuario: la predeterminada primero, después las más nuevas. */
  listLive(userId: string): Promise<SavedCard[]>;
  countLive(userId: string): Promise<number>;
  findLive(userId: string, id: string): Promise<SavedCard | null>;
  /**
   * Alta atómica: bajo un lock por usuario resuelve duplicado, tope y predeterminada (la
   * primera tarjeta viva queda como predeterminada).
   */
  create(userId: string, data: NewSavedCard, maxLive: number): Promise<CreateSavedCardResult>;
  /** Desmarca la anterior y marca esta, en una transacción. `null` si no es del usuario o ya no está viva. */
  setDefault(userId: string, id: string): Promise<SavedCard | null>;
  updateAlias(userId: string, id: string, alias: string | null): Promise<SavedCard | null>;
  /** ¿Hay un hold vivo (`LIVE_HOLD_STATUSES`) creado con esa tarjeta guardada? */
  hasLiveHold(id: string): Promise<boolean>;
  /**
   * Baja soft. Si era la predeterminada, promueve a la viva más reciente. `null` si no es del
   * usuario o ya estaba dada de baja.
   */
  softDelete(userId: string, id: string): Promise<SavedCard | null>;
  /** Borra TODAS las filas locales del usuario (baja de cuenta, MOVO-39). */
  deleteAllForUser(userId: string): Promise<DeletedUserCards>;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/** Serializa las escrituras de un mismo usuario (alta, predeterminada, baja) dentro de la transacción. */
async function lockUser(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  // $executeRaw y no $queryRaw: la función devuelve `void`, un tipo que Prisma no deserializa.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`saved_cards:${userId}`}))`;
}

export function createSavedCardRepository(db: PrismaClient): SavedCardRepository {
  return {
    findCustomer(userId) {
      return db.payerCustomer.findUnique({ where: { userId } });
    },

    async saveCustomer(userId, mpCustomerId) {
      try {
        return await db.payerCustomer.upsert({
          where: { userId },
          create: { userId, mpCustomerId },
          update: {},
        });
      } catch (error) {
        // Dos upserts concurrentes pueden chocar en el índice único antes de que el segundo
        // vea la fila: la que ganó es la buena.
        if (isUniqueViolation(error)) {
          const existing = await db.payerCustomer.findUnique({ where: { userId } });
          if (existing) return existing;
        }
        throw error;
      }
    },

    listLive(userId) {
      return db.savedCard.findMany({
        where: { userId, deletedAt: null },
        orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
      });
    },

    countLive(userId) {
      return db.savedCard.count({ where: { userId, deletedAt: null } });
    },

    findLive(userId, id) {
      return db.savedCard.findFirst({ where: { id, userId, deletedAt: null } });
    },

    create(userId, data, maxLive) {
      return db.$transaction(async (tx): Promise<CreateSavedCardResult> => {
        await lockUser(tx, userId);
        const live = await tx.savedCard.findMany({ where: { userId, deletedAt: null } });
        const duplicate = live.find(
          (card) =>
            card.mpCardId === data.mpCardId ||
            (card.brand === data.brand &&
              card.last4 === data.last4 &&
              card.expMonth === data.expMonth &&
              card.expYear === data.expYear)
        );
        if (duplicate) return { kind: "duplicate", card: duplicate };
        if (live.length >= maxLive) return { kind: "limit_reached" };
        const card = await tx.savedCard.create({
          data: { userId, ...data, isDefault: live.length === 0 },
        });
        return { kind: "created", card };
      });
    },

    setDefault(userId, id) {
      return db.$transaction(async (tx) => {
        await lockUser(tx, userId);
        const card = await tx.savedCard.findFirst({ where: { id, userId, deletedAt: null } });
        if (!card) return null;
        // Primero se desmarca: el índice único parcial no admite dos predeterminadas ni de paso.
        await tx.savedCard.updateMany({
          where: { userId, deletedAt: null, isDefault: true, NOT: { id } },
          data: { isDefault: false },
        });
        return tx.savedCard.update({ where: { id }, data: { isDefault: true } });
      });
    },

    async updateAlias(userId, id, alias) {
      const { count } = await db.savedCard.updateMany({
        where: { id, userId, deletedAt: null },
        data: { alias },
      });
      if (count === 0) return null;
      return db.savedCard.findUnique({ where: { id } });
    },

    async hasLiveHold(id) {
      const count = await db.hold.count({
        where: { savedCardId: id, status: { in: [...LIVE_HOLD_STATUSES] } },
      });
      return count > 0;
    },

    softDelete(userId, id) {
      return db.$transaction(async (tx) => {
        await lockUser(tx, userId);
        const card = await tx.savedCard.findFirst({ where: { id, userId, deletedAt: null } });
        if (!card) return null;
        const deleted = await tx.savedCard.update({
          where: { id },
          data: { deletedAt: new Date(), isDefault: false },
        });
        if (card.isDefault) {
          const next = await tx.savedCard.findFirst({
            where: { userId, deletedAt: null },
            orderBy: { createdAt: "desc" },
          });
          if (next) await tx.savedCard.update({ where: { id: next.id }, data: { isDefault: true } });
        }
        return deleted;
      });
    },

    deleteAllForUser(userId) {
      return db.$transaction(async (tx) => {
        await lockUser(tx, userId);
        const customer = await tx.payerCustomer.findUnique({ where: { userId } });
        const { count } = await tx.savedCard.deleteMany({ where: { userId } });
        if (customer) await tx.payerCustomer.delete({ where: { userId } });
        return { mpCustomerId: customer?.mpCustomerId ?? null, cardCount: count };
      });
    },
  };
}
