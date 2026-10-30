import { PrismaClient } from "../generated/prisma/client";
import { PickupEvidenceSummary, PickupPositionEvidence } from "../domain/pickup-attribution";

export interface PickupArrivalInput {
  arrivedAt: Date;
  lat: number;
  lng: number;
  accuracyM: number;
}

/**
 * MOVO-270 (DD-052): evidencia GPS agregada del retiro, una fila por envío (`shipments.pickup_evidence`),
 * atada al transportista de la asignación vigente: la evidencia de otro transportista ni se lee ni se suma.
 */
export interface PickupEvidenceRepository {
  /**
   * Registra una posición clasificada. La llegada se guarda UNA sola vez (la primera gana,
   * `arrived_at IS NULL`); las lejanas y las de zona gris suman a su contador. Devuelve `true`
   * si esta llamada registró la llegada.
   */
  record(shipmentId: string, carrierId: string, evidence: PickupPositionEvidence, arrival: PickupArrivalInput): Promise<boolean>;
  find(shipmentId: string, carrierId: string): Promise<PickupEvidenceSummary | null>;
  /** MOVO-341: la fila completa (posición de llegada incluida) para el panel, sin importar el transportista. */
  findDetail(shipmentId: string): Promise<PickupEvidenceDetail | null>;
}

export interface PickupEvidenceDetail extends PickupEvidenceSummary {
  carrierId: string;
  arrival: { lat: number; lng: number; accuracyM: number; capturedAt: Date } | null;
  /** Última vez que se sumó una posición clasificada. */
  updatedAt: Date;
}

export function createPickupEvidenceRepository(db: PrismaClient): PickupEvidenceRepository {
  return {
    async record(shipmentId, carrierId, evidence, arrival) {
      // La fila de una asignación anterior (otro transportista) se descarta antes de sumar.
      await db.pickupEvidence.deleteMany({ where: { shipmentId, carrierId: { not: carrierId } } });
      if (evidence === "arrival") {
        // Upsert vacío primero: dos posiciones concurrentes no chocan en el INSERT, y el UPDATE
        // condicional decide quién registró la llegada.
        await db.pickupEvidence.upsert({ where: { shipmentId }, create: { shipmentId, carrierId }, update: {} });
        const updated = await db.pickupEvidence.updateMany({
          where: { shipmentId, carrierId, arrivedAt: null },
          data: {
            arrivedAt: arrival.arrivedAt,
            arrivedLat: arrival.lat,
            arrivedLng: arrival.lng,
            arrivedAccuracyM: arrival.accuracyM,
          },
        });
        return updated.count === 1;
      }
      const field = evidence === "far" ? "farPositionsInWindow" : "grayPositionsInWindow";
      await db.pickupEvidence.upsert({
        where: { shipmentId },
        create: { shipmentId, carrierId, [field]: 1 },
        update: { [field]: { increment: 1 } },
      });
      return false;
    },

    async find(shipmentId, carrierId) {
      const row = await db.pickupEvidence.findUnique({ where: { shipmentId } });
      if (!row || row.carrierId !== carrierId) return null;
      return {
        arrivedAt: row.arrivedAt,
        farPositionsInWindow: row.farPositionsInWindow,
        grayPositionsInWindow: row.grayPositionsInWindow,
      };
    },

    async findDetail(shipmentId) {
      const row = await db.pickupEvidence.findUnique({ where: { shipmentId } });
      if (!row) return null;
      return {
        carrierId: row.carrierId,
        arrivedAt: row.arrivedAt,
        farPositionsInWindow: row.farPositionsInWindow,
        grayPositionsInWindow: row.grayPositionsInWindow,
        arrival:
          row.arrivedAt && row.arrivedLat && row.arrivedLng
            ? {
                lat: row.arrivedLat.toNumber(),
                lng: row.arrivedLng.toNumber(),
                accuracyM: row.arrivedAccuracyM ? row.arrivedAccuracyM.toNumber() : 0,
                capturedAt: row.arrivedAt,
              }
            : null,
        updatedAt: row.updatedAt,
      };
    },
  };
}
