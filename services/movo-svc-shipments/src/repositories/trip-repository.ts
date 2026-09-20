import { PrismaClient } from "../generated/prisma/client";
import { ShipmentStatus, TripStatus } from "@movo/shared";
import {
  Trip,
  CreateTripInput,
  UpdateTripInput,
  TripWithAcceptedPackages,
  mapTrip,
} from "../models/trip";
import { distanceToSegmentKm } from "../domain/geo";

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
  findActiveTripsMatchingShipment(params: MatchShipmentParams): Promise<Trip[]>;
}

export interface MatchShipmentParams {
  pickupLat: number;
  pickupLng: number;
  deliveryLat: number;
  deliveryLng: number;
  /** Viajes de estos carriers se descartan (senderId/receiverId del envío) -- mismo
   * criterio de auto-exclusión que `GET /shipments/available` (MOVO-142). */
  excludeCarrierIds: string[];
  radiusKm: number;
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

    /**
     * MOVO-179: matching inverso de MOVO-161/50 -- dado un envío (retiro+entrega), qué
     * viajes `active` de otros usuarios lo tienen dentro de su corredor (radio de
     * desvío `radiusKm`, ± sobre el segmento origen→destino del viaje). A diferencia
     * de `shipment-repository.ts#listAvailable` (matching directo: segmento FIJO del
     * caller, filtrado en SQL sobre muchas filas de `shipments`), acá el segmento
     * varía POR CADA `Trip` candidato -- se resuelve trayendo los viajes `active` (ya
     * acotados por `trips_status_idx` + exclusión de carrier) y filtrando en memoria
     * con `distanceToSegmentKm` (`domain/geo.ts`), sin portar el corredor a
     * `$queryRaw`. Decisión deliberada, no una limitación: el volumen esperado de
     * viajes `active` simultáneos es bajo (mismo criterio que descartó un índice
     * compuesto en MOVO-130 por bajo volumen) -- si creciera, el candidato es un
     * prefiltro `corridorBoundingBox` análogo al del matching directo.
     */
    async findActiveTripsMatchingShipment(params: MatchShipmentParams): Promise<Trip[]> {
      const rows = await db.trip.findMany({
        where: {
          status: TripStatus.ACTIVE,
          carrierId: { notIn: params.excludeCarrierIds },
        },
      });

      return rows
        .map(mapTrip)
        .filter((trip) => {
          const pickupDistanceKm = distanceToSegmentKm(
            params.pickupLat,
            params.pickupLng,
            trip.originLat,
            trip.originLng,
            trip.destinationLat,
            trip.destinationLng
          );
          const deliveryDistanceKm = distanceToSegmentKm(
            params.deliveryLat,
            params.deliveryLng,
            trip.originLat,
            trip.originLng,
            trip.destinationLat,
            trip.destinationLng
          );
          return pickupDistanceKm <= params.radiusKm && deliveryDistanceKm <= params.radiusKm;
        });
    },
  };
}
