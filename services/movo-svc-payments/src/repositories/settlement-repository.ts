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

    findOrCreateProcessing(data) {
      return db.settlement.upsert({
        where: { shipmentId: data.shipmentId },
        // Si ya existe no se toca nada: el estado lo gobierna quien lo recibe.
        update: {},
        create: {
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
