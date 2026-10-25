import { ShipmentStatus } from "@movo/shared";
import { PrismaClient, TripStatus } from "../generated/prisma/client";
import { POSITION_PURGE_ELIGIBLE_STATUSES } from "../domain/shipment-state-machine";

export interface ShipmentPurgeCandidate {
  id: string;
  senderId: string;
  receiverId: string;
  carrierId: string | null;
  photoKeys: string[];
}

export interface TripPurgeCandidate {
  id: string;
  carrierId: string;
}

/** Estados de un viaje que ya no van a cambiar (DD-029). */
const TRIP_CLOSED_STATUSES: TripStatus[] = ["cancelled", "expired", "completed"];

export interface RetentionRepository {
  /**
   * MOVO-230: envíos cerrados (`POSITION_PURGE_ELIGIBLE_STATUSES`, sin `disputed`) cuyo último
   * cambio de estado es anterior a `cutoff`, de a `limit` y ordenados por id, a partir de
   * `afterId`. Es solo un prefiltro: la regla de las partes dadas de baja la aplica el servicio.
   */
  findShipmentCandidates(cutoff: Date, limit: number, afterId?: string): Promise<ShipmentPurgeCandidate[]>;
  /** Borra el envío; el cascade se lleva eventos, fotos, ofertas, chat, calificaciones,
   * handshakes, posiciones y pedidos de cambio de receptor. */
  deleteShipment(id: string): Promise<void>;
  /** MOVO-230: viajes cerrados cuya última modificación es anterior a `cutoff`, mismo
   * paginado que `findShipmentCandidates`. */
  findTripCandidates(cutoff: Date, limit: number, afterId?: string): Promise<TripPurgeCandidate[]>;
  /** Borra los viajes; el cascade se lleva sus posiciones y deja en null `Offer.tripId`. */
  deleteTrips(ids: string[]): Promise<number>;
}

export function createRetentionRepository(db: PrismaClient): RetentionRepository {
  return {
    async findShipmentCandidates(cutoff, limit, afterId) {
      const rows = await db.shipment.findMany({
        where: {
          status: { in: POSITION_PURGE_ELIGIBLE_STATUSES as ShipmentStatus[] },
          lastStatusChangedAt: { lte: cutoff },
          ...(afterId ? { id: { gt: afterId } } : {}),
        },
        orderBy: { id: "asc" },
        take: limit,
        select: { id: true, senderId: true, receiverId: true, carrierId: true, photos: { select: { s3Key: true } } },
      });
      return rows.map((row) => ({
        id: row.id,
        senderId: row.senderId,
        receiverId: row.receiverId,
        carrierId: row.carrierId,
        photoKeys: row.photos.map((photo) => photo.s3Key),
      }));
    },

    async deleteShipment(id) {
      await db.shipment.delete({ where: { id } });
    },

    async findTripCandidates(cutoff, limit, afterId) {
      return db.trip.findMany({
        where: {
          status: { in: TRIP_CLOSED_STATUSES },
          updatedAt: { lte: cutoff },
          ...(afterId ? { id: { gt: afterId } } : {}),
        },
        orderBy: { id: "asc" },
        take: limit,
        select: { id: true, carrierId: true },
      });
    },

    async deleteTrips(ids) {
      if (ids.length === 0) {
        return 0;
      }
      const result = await db.trip.deleteMany({ where: { id: { in: ids } } });
      return result.count;
    },
  };
}
