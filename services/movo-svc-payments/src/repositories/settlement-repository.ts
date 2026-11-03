import { Prisma, PrismaClient } from "../generated/prisma/client";
import type { Settlement, SettlementKind, SettlementStatus } from "../generated/prisma/client";

export type { Settlement };

/** MOVO-213: una liquidación pendiente de reintento o escalada, con el vencimiento del hold que la respalda. */
export type SettlementWithHold = Settlement & { hold: { expiresAt: Date | null } };

/** Lo que se sabe de la liquidación ANTES de hablar con MP: sale del hold (y del pedido, MOVO-306). */
export interface NewSettlement {
  shipmentId: string;
  kind: SettlementKind;
  holdId: string;
  carrierId: string;
  mpPaymentId: string;
  grossAmountArs: Prisma.Decimal;
  commissionArs: Prisma.Decimal;
}

export interface SettlementUpdate {
  status?: SettlementStatus;
  failureReason?: string | null;
  statusDetail?: string | null;
  mpFeeArs?: Prisma.Decimal | null;
  commissionArs?: Prisma.Decimal;
  /** MOVO-311: deuda cobrada en la captura, aparte de la comisión. */
  debtOffsetArs?: Prisma.Decimal;
  debtSurchargeArs?: Prisma.Decimal;
  debtSurchargeFeeArs?: Prisma.Decimal;
  /** Cobro del transportista sin el recargo del emisor, fijado al acreditar (ver `carrierPaymentView`). */
  carrierGrossAmountArs?: Prisma.Decimal;
  carrierMpFeeArs?: Prisma.Decimal | null;
  netAmountArs?: Prisma.Decimal | null;
  capturedAt?: Date | null;
  /** MOVO-213: reintentos de la captura (ver el modelo `Settlement`). */
  attempts?: number;
  nextAttemptAt?: Date | null;
  lastError?: string | null;
  escalatedAt?: Date | null;
  escalationReason?: string | null;
}

export interface SettlementRepository {
  findByShipment(shipmentId: string): Promise<Settlement | null>;
  /**
   * Devuelve la liquidación del envío, creándola en `processing` si no existe. Atómico:
   * dos pedidos de captura a la vez terminan con UNA fila (índice único por `shipment_id`),
   * que es lo que impide registrar dos cobros del mismo envío.
   */
  findOrCreateProcessing(data: NewSettlement): Promise<Settlement>;
  /**
   * Reemplaza una liquidación `failed` por una nueva en `processing` (otro tipo o monto), limpiando el estado del
   * intento anterior. Condicional sobre `failed`: `false` si otro llamador ya la movió.
   */
  replaceFailed(id: string, data: NewSettlement): Promise<boolean>;
  update(id: string, patch: SettlementUpdate): Promise<Settlement>;
  /**
   * UPDATE condicional sobre el estado: aplica el cambio SOLO si la liquidación sigue en
   * `expected`. `false` si otro llamador ya la movió (p. ej. la acreditó). Es lo que impide que
   * un fallo tardío pise una liquidación `credited` por una carrera entre la captura en línea y
   * el reintento (mismo patrón que `holds.markCaptured`).
   */
  updateIfStatus(id: string, expected: SettlementStatus, patch: SettlementUpdate): Promise<boolean>;
  /**
   * MOVO-213: entregas `failed` cuyo próximo intento ya llegó, las más atrasadas primero. Solo `delivery`: la
   * penalidad la reintenta `svc-shipments` (que decide el plan B), no este barrido.
   */
  findDueForRetry(now: Date, limit: number): Promise<Settlement[]>;
  /**
   * MOVO-213: reserva un reintento corriendo `next_attempt_at` al fin de un lease, condicional sobre el valor que
   * leyó el barrido. `false` si otra réplica (o la captura en línea) ya la tomó: no se reintenta dos veces a la vez.
   */
  claimRetry(id: string, expectedNextAttemptAt: Date, leaseUntil: Date): Promise<boolean>;
  /**
   * MOVO-213 (AC6): entregas en un estado, las más recientes primero, con cursor keyset `(updated_at, id)`. Solo
   * `delivery`: la penalidad de cancelación también puede quedar `failed`, pero la maneja `svc-shipments` (plan B,
   * deuda del emisor) y no es un cobro demorado al transportista.
   */
  listByStatus(
    status: SettlementStatus,
    limit: number,
    cursor?: { updatedAt: Date; id: string }
  ): Promise<SettlementWithHold[]>;
}

export function createSettlementRepository(db: PrismaClient): SettlementRepository {
  return {
    findByShipment(shipmentId) {
      return db.settlement.findUnique({ where: { shipmentId } });
    },

    async findOrCreateProcessing(data) {
      // No es un `upsert`: con `update: {}` Prisma no puede resolverlo con un único `INSERT … ON CONFLICT` (el upsert
      // nativo exige un `update` con datos) y emite un SELECT seguido de un INSERT (verificado con el query log de
      // Prisma), así que dos capturas a la vez pueden pasar las dos el SELECT y la perdedora cae en P2002. Se inserta y,
      // si el índice único por `shipment_id` dice que ya existe, se lee la fila que ganó. Si ya existe no se toca nada:
      // el estado lo gobierna quien lo recibe.
      try {
        return await db.settlement.create({
          data: {
            shipmentId: data.shipmentId,
            kind: data.kind,
            holdId: data.holdId,
            carrierId: data.carrierId,
            mpPaymentId: data.mpPaymentId,
            grossAmountArs: data.grossAmountArs,
            commissionArs: data.commissionArs,
            status: "processing",
          },
        });
      } catch (error) {
        if (typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002") {
          const existing = await db.settlement.findUnique({ where: { shipmentId: data.shipmentId } });
          if (existing) return existing;
        }
        throw error;
      }
    },

    async replaceFailed(id, data) {
      const { count } = await db.settlement.updateMany({
        where: { id, status: "failed" },
        data: {
          kind: data.kind,
          grossAmountArs: data.grossAmountArs,
          commissionArs: data.commissionArs,
          status: "processing",
          failureReason: null,
          statusDetail: null,
          mpFeeArs: null,
          netAmountArs: null,
          attempts: 0,
          nextAttemptAt: null,
          lastError: null,
          escalatedAt: null,
          escalationReason: null,
        },
      });
      return count === 1;
    },

    update(id, patch) {
      return db.settlement.update({ where: { id }, data: patch });
    },

    async updateIfStatus(id, expected, patch) {
      const { count } = await db.settlement.updateMany({ where: { id, status: expected }, data: patch });
      return count === 1;
    },

    findDueForRetry(now, limit) {
      return db.settlement.findMany({
        where: { status: "failed", kind: "delivery", nextAttemptAt: { lte: now } },
        orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }],
        take: limit,
      });
    },

    async claimRetry(id, expectedNextAttemptAt, leaseUntil) {
      const { count } = await db.settlement.updateMany({
        where: { id, status: "failed", nextAttemptAt: expectedNextAttemptAt },
        data: { nextAttemptAt: leaseUntil },
      });
      return count === 1;
    },

    listByStatus(status, limit, cursor) {
      return db.settlement.findMany({
        where: {
          status,
          kind: "delivery",
          ...(cursor
            ? { OR: [{ updatedAt: { lt: cursor.updatedAt } }, { updatedAt: cursor.updatedAt, id: { lt: cursor.id } }] }
            : {}),
        },
        include: { hold: { select: { expiresAt: true } } },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: limit,
      });
    },
  };
}
