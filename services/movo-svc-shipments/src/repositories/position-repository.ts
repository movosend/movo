import { ShipmentStatus } from "@movo/shared";
import { PrismaClient, CarrierPosition as CarrierPositionRow } from "../generated/prisma/client";
import { POSITION_PURGE_ELIGIBLE_STATUSES } from "../domain/shipment-state-machine";
import { CarrierPosition, CreateCarrierPositionInput } from "../models/carrier-position";

function mapPosition(row: CarrierPositionRow): CarrierPosition {
  return {
    id: row.id,
    shipmentId: row.shipmentId,
    lat: row.lat.toNumber(),
    lng: row.lng.toNumber(),
    accuracyM: row.accuracyM.toNumber(),
    capturedAt: row.capturedAt,
    recordedAt: row.recordedAt,
  };
}

export interface PositionRepository {
  /** AC9: única vía de escritura -- append-only, sin `update()`. */
  create(input: CreateCarrierPositionInput): Promise<CarrierPosition>;
  /**
   * MOVO-202/AC6: borra las posiciones de todo envío elegible
   * (`POSITION_PURGE_ELIGIBLE_STATUSES`) cuyo `lastStatusChangedAt` ya superó
   * `retentionDays`. Devuelve la cantidad de filas borradas (métrica del job).
   */
  purgeEligibleClosedShipments(now: Date, retentionDays: number): Promise<number>;
  /**
   * MOVO-202/AC7: borra TODAS las posiciones de los envíos donde el usuario dado fue
   * transportista, sin importar retención -- la baja de cuenta (MOVO-39) es supresión
   * inmediata, no sujeta al plazo normal de `purgeEligibleClosedShipments`.
   */
  deleteAllForCarrier(carrierId: string): Promise<number>;
}

export function createPositionRepository(db: PrismaClient): PositionRepository {
  return {
    async create(input: CreateCarrierPositionInput): Promise<CarrierPosition> {
      const created = await db.carrierPosition.create({
        data: {
          shipmentId: input.shipmentId,
          lat: input.lat,
          lng: input.lng,
          accuracyM: input.accuracyM,
          capturedAt: input.capturedAt,
        },
      });
      return mapPosition(created);
    },

    async purgeEligibleClosedShipments(now: Date, retentionDays: number): Promise<number> {
      const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
      const result = await db.carrierPosition.deleteMany({
        where: {
          shipment: {
            status: { in: POSITION_PURGE_ELIGIBLE_STATUSES as ShipmentStatus[] },
            lastStatusChangedAt: { lte: cutoff },
          },
        },
      });
      return result.count;
    },

    async deleteAllForCarrier(carrierId: string): Promise<number> {
      const result = await db.carrierPosition.deleteMany({
        where: { shipment: { carrierId } },
      });
      return result.count;
    },
  };
}
