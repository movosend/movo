import { Prisma, PrismaClient } from "../generated/prisma/client";
import type { Hold, HoldFailureReason, HoldStatus } from "../generated/prisma/client";

export type { Hold };

export interface NewHoldAttempt {
  shipmentId: string;
  attempt: number;
  carrierId: string;
  collectorId: string;
  amountArs: number;
  applicationFeeArs: number;
  /** Hash del cuerpo del pedido (token, pagador, medio de pago): ver `requestFingerprint`. */
  requestFingerprint: string;
  /** MOVO-282: tarjeta guardada con la que se crea el hold (habilita el `409 CARD_IN_USE` al borrarla). */
  savedCardId?: string | null;
  /**
   * MOVO-302: el emisor que paga (`payerUserId`, MOVO-282). Es lo que permite listar "lo que pagó
   * cada emisor" en el historial; null en los holds anteriores. Opcional para no romper a quien
   * crea intentos sin saber quién paga.
   */
  payerId?: string | null;
}

export interface HoldUpdate {
  status?: HoldStatus;
  statusDetail?: string | null;
  failureReason?: HoldFailureReason | null;
  mpPaymentId?: string | null;
  expiresAt?: Date | null;
  /**
   * MOVO-302: últimos 4 y marca de la tarjeta, tal como los informa MP en el pago. Solo se
   * escriben cuando MP los trae (`undefined` = no tocar): una respuesta sin `card` nunca borra
   * un dato que una consulta anterior ya había dejado.
   */
  cardLast4?: string;
  cardBrand?: string;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/** Otro request ganó la carrera por el mismo intento (o por el hold vivo del envío). */
export class HoldAttemptConflictError extends Error {
  constructor() {
    super("Ya existe un intento de hold concurrente para el envío");
    this.name = "HoldAttemptConflictError";
  }
}

export interface HoldRepository {
  /** El intento más reciente del envío (mayor `attempt`), cualquiera sea su estado. */
  findLatestByShipment(shipmentId: string): Promise<Hold | null>;
  findById(id: string): Promise<Hold | null>;
  /** MOVO-268: el intento al que MP le asignó ese pago, si existe. */
  findByMpPaymentId(mpPaymentId: string): Promise<Hold | null>;
  /**
   * Inserta un intento en `creating`. Tira `HoldAttemptConflictError` si otro request ya
   * lo creó (`shipment_id`+`attempt`) o si el envío ya tiene un hold vivo (índice parcial).
   */
  createAttempt(data: NewHoldAttempt): Promise<Hold>;
  update(id: string, patch: HoldUpdate): Promise<Hold>;
  /**
   * MOVO-212: `authorized` → `captured` como UPDATE condicional. Devuelve `false` si el hold ya
   * no estaba `authorized` (el webhook de MOVO-268 lo movió en el medio): no se pisa.
   */
  markCaptured(
    id: string,
    patch: { statusDetail: string | null; cardLast4?: string; cardBrand?: string }
  ): Promise<boolean>;
}

export function createHoldRepository(db: PrismaClient): HoldRepository {
  return {
    findLatestByShipment(shipmentId) {
      return db.hold.findFirst({ where: { shipmentId }, orderBy: { attempt: "desc" } });
    },

    findById(id) {
      return db.hold.findUnique({ where: { id } });
    },

    findByMpPaymentId(mpPaymentId) {
      return db.hold.findFirst({ where: { mpPaymentId }, orderBy: { attempt: "desc" } });
    },

    async createAttempt(data) {
      try {
        return await db.hold.create({
          data: {
            shipmentId: data.shipmentId,
            attempt: data.attempt,
            carrierId: data.carrierId,
            collectorId: data.collectorId,
            amountArs: new Prisma.Decimal(data.amountArs),
            applicationFeeArs: new Prisma.Decimal(data.applicationFeeArs),
            requestFingerprint: data.requestFingerprint,
            savedCardId: data.savedCardId ?? null,
            payerId: data.payerId ?? null,
            status: "creating",
          },
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw new HoldAttemptConflictError();
        throw error;
      }
    },

    update(id, patch) {
      return db.hold.update({ where: { id }, data: patch });
    },

    async markCaptured(id, patch) {
      const { count } = await db.hold.updateMany({
        where: { id, status: "authorized" },
        data: {
          status: "captured",
          statusDetail: patch.statusDetail,
          expiresAt: null,
          // MOVO-302: la captura es la última lectura del pago; completa la tarjeta si faltaba.
          ...(patch.cardLast4 ? { cardLast4: patch.cardLast4 } : {}),
          ...(patch.cardBrand ? { cardBrand: patch.cardBrand } : {}),
        },
      });
      return count === 1;
    },
  };
}
