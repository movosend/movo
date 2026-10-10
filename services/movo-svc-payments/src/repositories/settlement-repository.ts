import { Prisma, PrismaClient } from "../generated/prisma/client";
import type { Settlement, SettlementStatus } from "../generated/prisma/client";

export type { Settlement };

/** Lo que se sabe de la liquidación ANTES de hablar con MP: sale del hold. */
export interface NewSettlement {
  shipmentId: string;
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
  };
}
