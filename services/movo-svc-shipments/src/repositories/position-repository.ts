import { OfferStatus, ShipmentStatus } from "@movo/shared";
import { PrismaClient, CarrierPosition as CarrierPositionRow } from "../generated/prisma/client";
import { POSITION_PURGE_ELIGIBLE_STATUSES } from "../domain/shipment-state-machine";
import { CarrierPosition, CreateCarrierPositionInput } from "../models/carrier-position";

function mapPosition(row: CarrierPositionRow): CarrierPosition {
  return {
    id: row.id,
    shipmentId: row.shipmentId,
    tripId: row.tripId,
    lat: row.lat.toNumber(),
    lng: row.lng.toNumber(),
    accuracyM: row.accuracyM.toNumber(),
    capturedAt: row.capturedAt,
    recordedAt: row.recordedAt,
    mocked: row.mocked,
  };
}

export interface PositionRepository {
  /** AC9: única vía de escritura -- append-only, sin `update()`. */
  create(input: CreateCarrierPositionInput): Promise<CarrierPosition>;
  /**
   * MOVO-270 (AC3): traza del tramo con custodia de un envío, para disputas. Se resuelve por el
   * viaje (`trip_id` de su oferta aceptada) y el rango entre su handshake de retiro
   * (`-> in_transit`) y el de entrega (`in_transit ->`, o ahora si sigue en tránsito), NO por
   * el `shipmentId` de la fila: con varios envíos en custodia en el mismo viaje, cada fila se
   * asocia a uno solo de ellos (AC2). Ordenada por `capturedAt`. Vacía si nunca hubo retiro.
   */
  listCustodyTrace(shipmentId: string): Promise<CarrierPosition[]>;
  /** MOVO-341: `capturedAt` de la última posición de esa misma traza, sin cargarla entera; `null` si no hay. */
  findLastCustodyCapturedAt(shipmentId: string): Promise<Date | null>;
  /**
   * MOVO-202/AC6, rehecho por MOVO-270: borra las posiciones de todo envío elegible
   * (`POSITION_PURGE_ELIGIBLE_STATUSES`) cuyo `lastStatusChangedAt` ya superó
   * `retentionDays`, siempre que NINGÚN otro envío aceptado del mismo viaje siga reteniendo la
   * traza (abierto, disputado o cerrado hace menos de la retención): desde el AC2 una fila del
   * viaje puede ser la evidencia de otro envío. Devuelve la cantidad de filas borradas.
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
  /** Filtro de las posiciones con custodia del envío (viaje de la oferta aceptada y rango pickup-entrega); `null` si no hubo retiro. */
  async function custodyWindow(
    shipmentId: string,
  ): Promise<{ tripId: string; capturedAt: { gte: Date; lte?: Date } } | null> {
    const [offer, pickupEvent, deliveryEvent] = await Promise.all([
      db.offer.findFirst({ where: { shipmentId, status: OfferStatus.ACCEPTED, tripId: { not: null } }, select: { tripId: true } }),
      db.shipmentEvent.findFirst({
        where: { shipmentId, toStatus: ShipmentStatus.IN_TRANSIT },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
      db.shipmentEvent.findFirst({
        where: { shipmentId, fromStatus: ShipmentStatus.IN_TRANSIT },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
    ]);
    if (!offer?.tripId || !pickupEvent) return null;
    return {
      tripId: offer.tripId,
      capturedAt: { gte: pickupEvent.createdAt, ...(deliveryEvent ? { lte: deliveryEvent.createdAt } : {}) },
    };
  }

  return {
    async create(input: CreateCarrierPositionInput): Promise<CarrierPosition> {
      const created = await db.carrierPosition.create({
        data: {
          shipmentId: input.shipmentId,
          tripId: input.tripId,
          lat: input.lat,
          lng: input.lng,
          accuracyM: input.accuracyM,
          capturedAt: input.capturedAt,
          mocked: input.mocked ?? null,
        },
      });
      return mapPosition(created);
    },

    async listCustodyTrace(shipmentId: string): Promise<CarrierPosition[]> {
      const window = await custodyWindow(shipmentId);
      if (!window) return [];
      const rows = await db.carrierPosition.findMany({
        where: window,
        orderBy: { capturedAt: "asc" },
      });
      return rows.map(mapPosition);
    },

    async findLastCustodyCapturedAt(shipmentId: string): Promise<Date | null> {
      const window = await custodyWindow(shipmentId);
      if (!window) return null;
      const last = await db.carrierPosition.findFirst({
        where: window,
        orderBy: { capturedAt: "desc" },
        select: { capturedAt: true },
      });
      return last?.capturedAt ?? null;
    },

    async purgeEligibleClosedShipments(now: Date, retentionDays: number): Promise<number> {
      const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
      const eligible = POSITION_PURGE_ELIGIBLE_STATUSES as ShipmentStatus[];
      const result = await db.carrierPosition.deleteMany({
        where: {
          shipment: {
            status: { in: eligible },
            lastStatusChangedAt: { lte: cutoff },
          },
          trip: {
            offers: {
              none: {
                status: OfferStatus.ACCEPTED,
                shipment: {
                  OR: [
                    { status: { notIn: eligible } },
                    { lastStatusChangedAt: null },
                    { lastStatusChangedAt: { gt: cutoff } },
                  ],
                },
              },
            },
          },
        },
      });
      return result.count;
    },

    async deleteAllForCarrier(carrierId: string): Promise<number> {
      const result = await db.carrierPosition.deleteMany({
        where: {
          OR: [{ shipment: { carrierId } }, { trip: { carrierId } }],
        },
      });
      return result.count;
    },
  };
}
