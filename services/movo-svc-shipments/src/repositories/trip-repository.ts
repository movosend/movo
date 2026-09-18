import { PrismaClient } from "../generated/prisma/client";
import { ShipmentStatus, TripStatus } from "@movo/shared";
import {
  Trip,
  CreateTripInput,
  UpdateTripInput,
  TripWithAcceptedPackages,
  mapTrip,
  parseTripStatus,
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

/**
 * MOVO-221: `POST /trips/:id/start` (o un `PATCH` que intente forzar `status: active`)
 * sobre un viaje que no está `declared` -- ya `active` (double-tap), `cancelled` o
 * `completed`. También se lanza si el compare-and-swap de `start()` pierde una carrera
 * contra otra operación concurrente que ya sacó el viaje de `declared` (en ese caso
 * `status` viaja `undefined`, no hay forma barata de saber a qué estado saltó sin una
 * relectura extra que no aporta nada práctico).
 */
export class TripNotDeclaredError extends Error {
  constructor(
    public readonly id: string,
    public readonly status?: TripStatus,
  ) {
    super(
      status
        ? `El viaje '${id}' no se puede iniciar porque no está en estado 'declared' (estado actual: '${status}')`
        : `El viaje '${id}' no se puede iniciar porque otra operación ya lo modificó`,
    );
    this.name = "TripNotDeclaredError";
  }
}

/**
 * MOVO-221 (AC "solo puede haber 1 viaje active por cuenta a la vez"): el transportista
 * ya tiene otro viaje `active` en curso. Se lanza al atrapar el `P2002` del índice único
 * parcial `trips_carrier_active_unique` (`(carrier_id) WHERE status='active'`) -- la
 * garantía real vive en Postgres, este error solo la traduce a un tipo de dominio
 * legible (mismo criterio que `DuplicateActiveOfferError`, MOVO-102).
 */
export class TripAlreadyHasActiveTripError extends Error {
  constructor(public readonly carrierId: string) {
    super(`El transportista '${carrierId}' ya tiene otro viaje 'active' en curso`);
    this.name = "TripAlreadyHasActiveTripError";
  }
}

function isUniqueConstraintConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
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
  /**
   * MOVO-221: única vía para transicionar `declared -> active`. Compare-and-swap
   * (`updateMany` condicionado por `status: declared`) -- si pierde la carrera contra
   * otra operación concurrente, `TripNotDeclaredError` sin `status`. Si viola el límite
   * de "1 active por carrier", `TripAlreadyHasActiveTripError` (índice único parcial).
   */
  start(id: string): Promise<Trip>;
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
          status: TripStatus.DECLARED,
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

      try {
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
      } catch (error) {
        // MOVO-221: un PATCH que fuerza `status: active` a mano (en vez de pasar por
        // `start()`) puede violar igual el límite de "1 active por carrier" --
        // el índice único parcial es la garantía real, esto solo la traduce.
        if (isUniqueConstraintConflict(error)) {
          throw new TripAlreadyHasActiveTripError(current.carrierId);
        }
        throw error;
      }
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

    async start(id: string): Promise<Trip> {
      const current = await db.trip.findUnique({ where: { id } });
      if (!current) {
        throw new TripNotFoundError(id);
      }
      if (current.status !== TripStatus.DECLARED) {
        throw new TripNotDeclaredError(id, parseTripStatus(current.status));
      }

      let result;
      try {
        result = await db.trip.updateMany({
          where: { id, status: TripStatus.DECLARED },
          data: { status: TripStatus.ACTIVE },
        });
      } catch (error) {
        if (isUniqueConstraintConflict(error)) {
          throw new TripAlreadyHasActiveTripError(current.carrierId);
        }
        throw error;
      }

      if (result.count === 0) {
        // Otra operación (otro `start()`, o un `PATCH` con `status`) ya sacó el viaje
        // de `declared` entre la relectura de arriba y este UPDATE.
        throw new TripNotDeclaredError(id);
      }

      const row = await db.trip.findUniqueOrThrow({ where: { id } });
      return mapTrip(row);
    },
  };
}
