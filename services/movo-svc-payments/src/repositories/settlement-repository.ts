import { Prisma, PrismaClient } from "../generated/prisma/client";
import type { Settlement, SettlementKind, SettlementStatus } from "../generated/prisma/client";

export type { Settlement };

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
  netAmountArs?: Prisma.Decimal | null;
  capturedAt?: Date | null;
}

export interface SettlementRepository {
  findByShipment(shipmentId: string): Promise<Settlement | null>;
  /**
   * Devuelve la liquidación del envío, creándola en `processing` si no existe. Atómico:
   * dos pedidos de captura a la vez terminan con UNA fila (índice único por `shipment_id`),
   * que es lo que impide registrar dos cobros del mismo envío.
   */
  findOrCreateProcessing(data: NewSettlement): Promise<Settlement>;
  update(id: string, patch: SettlementUpdate): Promise<Settlement>;
  /**
   * UPDATE condicional sobre el estado: aplica el cambio SOLO si la liquidación sigue en
   * `expected`. `false` si otro llamador ya la movió (p. ej. la acreditó). Es lo que impide que
   * un fallo tardío pise una liquidación `credited` por una carrera entre la captura en línea y
   * el reintento (mismo patrón que `holds.markCaptured`).
   */
  updateIfStatus(id: string, expected: SettlementStatus, patch: SettlementUpdate): Promise<boolean>;
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

    update(id, patch) {
      return db.settlement.update({ where: { id }, data: patch });
    },

    async updateIfStatus(id, expected, patch) {
      const { count } = await db.settlement.updateMany({ where: { id, status: expected }, data: patch });
      return count === 1;
    },
  };
}
