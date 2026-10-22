import { PrismaClient } from "../generated/prisma/client";
import { PickupEvidenceSummary, PickupPositionEvidence } from "../domain/pickup-attribution";

export interface PickupArrivalInput {
  arrivedAt: Date;
  lat: number;
  lng: number;
  accuracyM: number;
}

/** MOVO-270 (ADR-052): evidencia GPS agregada del retiro, una fila por envío (`shipments.pickup_evidence`). */
export interface PickupEvidenceRepository {
  /**
   * Registra una posición clasificada. La llegada se guarda UNA sola vez (la primera gana,
   * `arrived_at IS NULL`); las lejanas y las de zona gris suman a su contador. Devuelve `true`
   * si esta llamada registró la llegada.
   */
  record(shipmentId: string, evidence: PickupPositionEvidence, arrival: PickupArrivalInput): Promise<boolean>;
  find(shipmentId: string): Promise<PickupEvidenceSummary | null>;
}

export function createPickupEvidenceRepository(db: PrismaClient): PickupEvidenceRepository {
  return {
    async record(shipmentId, evidence, arrival) {
      if (evidence === "arrival") {
        // Upsert vacío primero: dos posiciones concurrentes no chocan en el INSERT, y el UPDATE
        // condicional decide quién registró la llegada.
        await db.pickupEvidence.upsert({ where: { shipmentId }, create: { shipmentId }, update: {} });
        const updated = await db.pickupEvidence.updateMany({
          where: { shipmentId, arrivedAt: null },
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
        create: { shipmentId, [field]: 1 },
        update: { [field]: { increment: 1 } },
      });
      return false;
    },

    async find(shipmentId) {
      const row = await db.pickupEvidence.findUnique({ where: { shipmentId } });
      if (!row) return null;
      return {
        arrivedAt: row.arrivedAt,
        farPositionsInWindow: row.farPositionsInWindow,
        grayPositionsInWindow: row.grayPositionsInWindow,
      };
    },
  };
}
