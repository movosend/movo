import { PrismaClient } from "../generated/prisma/client";
import { ShipmentStatus, TripStatus } from "@movo/shared";
import {
  Trip,
  CreateTripInput,
  UpdateTripInput,
  TripWithAcceptedPackages,
  mapTrip,
} from "../models/trip";

/**
 * Fragmento de filtro de "oferta que bloquea el viaje" — una oferta `accepted` cuyo
 * envío ya está `cancelled` NO cuenta como paquete aceptado (fix, MOVO-162): sin este
 * filtro, `cancelShipment` (`shipments.service.ts`) nunca toca la fila de `Offer` al
 * cancelar (queda `accepted` para siempre, apuntando a un envío muerto) y el viaje
 * quedaba bloqueado sin salida aunque el emisor cancelara el envío. Mismo criterio que
 * ya se aplicó una vez en `listShipmentOffers` (MOVO-144, PR #105): filtrar también por
 * `shipment.status`, no solo por el status de la oferta. Deliberadamente solo excluye
 * `CANCELLED` — un envío `disputed`/`delivered` sí representa un paquete aceptado real.
 */
const ACCEPTED_OFFER_FILTER = {
  status: "accepted",
  shipment: { status: { not: ShipmentStatus.CANCELLED } },
} as const;

export class TripNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`El viaje '${id}' no fue encontrado`);
    this.name = "TripNotFoundError";
  }
}

export class TripHasAcceptedPackagesError extends Error {
  constructor(public readonly id: string) {
    super(`El viaje '${id}' no se puede modificar ni cancelar porque ya tiene paquetes aceptados`);
    this.name = "TripHasAcceptedPackagesError";
  }
}

export interface TripRepository {
  create(input: CreateTripInput): Promise<Trip>;
  findById(id: string): Promise<Trip | null>;
  countAcceptedOffers(tripId: string): Promise<number>;
  listByCarrier(
    carrierId: string,
    page: number,
    limit: number,
    status?: TripStatus,
  ): Promise<{ items: TripWithAcceptedPackages[]; total: number }>;
  update(id: string, input: UpdateTripInput): Promise<Trip>;
  delete(id: string): Promise<void>;
}

export function createTripRepository(db: PrismaClient): TripRepository {
  return {
    async create(input: CreateTripInput): Promise<Trip> {
      const row = await db.trip.create({
        data: {
          carrierId: input.carrierId,
          originAddress: input.originAddress,
          originLat: input.originLat,
          originLng: input.originLng,
          destinationAddress: input.destinationAddress,
          destinationLat: input.destinationLat,
          destinationLng: input.destinationLng,
          departureAt: input.departureAt,
          vehicleType: input.vehicleType,
          status: TripStatus.ACTIVE,
        },
      });
      return mapTrip(row);
    },

    async findById(id: string): Promise<Trip | null> {
      const row = await db.trip.findUnique({ where: { id } });
      return row ? mapTrip(row) : null;
    },

    async countAcceptedOffers(tripId: string): Promise<number> {
      return db.offer.count({
        where: {
          tripId,
          ...ACCEPTED_OFFER_FILTER,
        },
      });
    },

    async listByCarrier(
      carrierId: string,
      page: number,
      limit: number,
      status?: TripStatus,
    ): Promise<{ items: TripWithAcceptedPackages[]; total: number }> {
      const where = {
        carrierId,
        ...(status ? { status } : {}),
      };

      const [rows, total] = await Promise.all([
        db.trip.findMany({
          where,
          orderBy: { departureAt: "asc" },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            _count: {
              select: {
                offers: {
                  where: ACCEPTED_OFFER_FILTER,
                },
              },
            },
          },
        }),
        db.trip.count({ where }),
      ]);

      const items: TripWithAcceptedPackages[] = rows.map((row) => ({
        ...mapTrip(row),
        hasAcceptedPackages: row._count.offers > 0,
      }));

      return { items, total };
    },

    async update(id: string, input: UpdateTripInput): Promise<Trip> {
      const current = await db.trip.findUnique({ where: { id } });
      if (!current) {
        throw new TripNotFoundError(id);
      }

      const acceptedCount = await db.offer.count({
        where: { tripId: id, ...ACCEPTED_OFFER_FILTER },
      });
      if (acceptedCount > 0) {
        throw new TripHasAcceptedPackagesError(id);
      }

      const updated = await db.trip.update({
        where: { id },
        data: {
          ...(input.originAddress !== undefined ? { originAddress: input.originAddress } : {}),
          ...(input.originLat !== undefined ? { originLat: input.originLat } : {}),
          ...(input.originLng !== undefined ? { originLng: input.originLng } : {}),
          ...(input.destinationAddress !== undefined ? { destinationAddress: input.destinationAddress } : {}),
          ...(input.destinationLat !== undefined ? { destinationLat: input.destinationLat } : {}),
          ...(input.destinationLng !== undefined ? { destinationLng: input.destinationLng } : {}),
          ...(input.departureAt !== undefined ? { departureAt: input.departureAt } : {}),
          ...(input.vehicleType !== undefined ? { vehicleType: input.vehicleType } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        },
      });

      return mapTrip(updated);
    },

    async delete(id: string): Promise<void> {
      const current = await db.trip.findUnique({ where: { id } });
      if (!current) {
        throw new TripNotFoundError(id);
      }

      const acceptedCount = await db.offer.count({
        where: { tripId: id, ...ACCEPTED_OFFER_FILTER },
      });
      if (acceptedCount > 0) {
        throw new TripHasAcceptedPackagesError(id);
      }

      await db.trip.delete({ where: { id } });
    },
  };
}
