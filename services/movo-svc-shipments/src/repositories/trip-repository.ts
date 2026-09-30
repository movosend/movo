import { PrismaClient } from "../generated/prisma/client";
import { ShipmentStatus, TripStatus } from "@movo/shared";
import {
  Trip,
  CreateTripInput,
  UpdateTripInput,
  TripWithAcceptedPackages,
  buildTripCreateData,
  mapTrip,
  parseTripStatus,
} from "../models/trip";
import { distanceToSegmentKm } from "../domain/geo";

/**
 * MOVO-138: prefiltro SQL de `countAvailableCarriersNear` -- un viaje solo puede pasar a
 * `radiusKm` del punto si el rectángulo que encierra su origen y destino, ensanchado
 * `radiusKm`, contiene el punto. Se deja pasar filas de más (las descarta
 * `distanceToSegmentKm` en memoria), nunca de menos: el ancho en longitud usa el coseno
 * de 60° y no el del punto, porque `distanceToSegmentKm` mide con la latitud media del
 * viaje, que puede quedar más al sur que el punto (Ushuaia está a ~55°S); y el alto
 * usa 110.574 km/°, el mismo `ky` de `distanceToSegmentKm` (más chico que 111.32).
 */
const PREFILTER_MIN_COS = Math.cos((60 * Math.PI) / 180);

function tripCorridorContainsPointWhere(lat: number, lng: number, radiusKm: number) {
  const latDelta = radiusKm / 110.574;
  const lngDelta = radiusKm / (111.32 * PREFILTER_MIN_COS);
  // LEAST(origen, destino) <= max AND GREATEST(origen, destino) >= min, sin `$queryRaw`.
  return [
    { OR: [{ originLat: { lte: lat + latDelta } }, { destinationLat: { lte: lat + latDelta } }] },
    { OR: [{ originLat: { gte: lat - latDelta } }, { destinationLat: { gte: lat - latDelta } }] },
    { OR: [{ originLng: { lte: lng + lngDelta } }, { destinationLng: { lte: lng + lngDelta } }] },
    { OR: [{ originLng: { gte: lng - lngDelta } }, { destinationLng: { gte: lng - lngDelta } }] },
  ];
}

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
  findByIdWithPackages(id: string): Promise<TripWithAcceptedPackages | null>;
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
  /**
   * MOVO-221: única vía para transicionar `declared -> active`. Compare-and-swap
   * (`updateMany` condicionado por `status: declared`) -- si pierde la carrera contra
   * otra operación concurrente, `TripNotDeclaredError` sin `status`. Si viola el límite
   * de "1 active por carrier", `TripAlreadyHasActiveTripError` (índice único parcial).
   */
  start(id: string): Promise<Trip>;
  /**
   * MOVO-238: cancela hasta `limit` viajes `declared` cuyo `departureAt` ya pasó y que no
   * tienen ningún paquete aceptado (mismo `ACCEPTED_OFFER_FILTER` que bloquea
   * `update`/`delete`). Un viaje `declared` vencido CON paquete aceptado se deja intacto
   * (AC2: bloquea, no cascadea -- mismo criterio que MOVO-134). Devuelve los ids
   * efectivamente cancelados.
   */
  cancelOverdueDeclared(now: Date, limit: number): Promise<string[]>;
  /**
   * MOVO-138 (ADR-025): transportistas DISTINTOS con un viaje `declared`/`active` que
   * sale dentro de la ventana dada y cuyo trayecto pasa a `radiusKm` o menos del
   * retiro -- la mitad "oferta" del `demandContext` de `POST /quote`. Un transportista
   * con dos viajes en la semana cuenta una vez.
   */
  countAvailableCarriersNear(params: AvailableCarriersParams): Promise<number>;
}

export interface AvailableCarriersParams {
  lat: number;
  lng: number;
  radiusKm: number;
  departureFrom: Date;
  departureTo: Date;
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
      // MOVO-234 (fix de review, PR #176): mapeo centralizado en `buildTripCreateData`
      // -- ver su comentario en `models/trip.ts` -- reusado también por
      // `offer-repository.ts#acceptOffer` para el `Trip` auto-creado.
      const row = await db.trip.create({ data: buildTripCreateData(input) });
      return mapTrip(row);
    },

    async findById(id: string): Promise<Trip | null> {
      const row = await db.trip.findUnique({ where: { id } });
      return row ? mapTrip(row) : null;
    },

    async findByIdWithPackages(id: string): Promise<TripWithAcceptedPackages | null> {
      const row = await db.trip.findUnique({
        where: { id },
        include: {
          offers: {
            where: ACCEPTED_OFFER_FILTER,
            include: {
              shipment: true,
            },
          },
        },
      });

      if (!row) {
        return null;
      }

      const offers = row.offers;
      const packages = offers.map((offer) => {
        const sh = offer.shipment;
        const pickupDateStr = offer.offeredDate.toISOString().slice(0, 10);
        
        const pickupTimeWindowStart = offer.offeredPickupTimeWindowStart 
          ?? sh.pickupTimeWindowStart.toISOString().slice(11, 19);
        const pickupTimeWindowEnd = offer.offeredPickupTimeWindowEnd 
          ?? sh.pickupTimeWindowEnd.toISOString().slice(11, 19);

        return {
          shipmentId: sh.id,
          status: sh.status as ShipmentStatus,
          packageType: sh.packageType,
          weightKg: sh.weightKg.toNumber(),
          pickupAddress: sh.pickupAddress,
          deliveryAddress: sh.deliveryAddress,
          pickupDate: pickupDateStr,
          pickupTimeWindowStart,
          pickupTimeWindowEnd,
          agreedPriceArs: offer.priceOffered.toNumber(),
          senderName: offer.senderNameAtOffer ?? "Emisor",
        };
      });

      // Sort by pickupDate and then by pickupTimeWindowStart ascending
      packages.sort((a, b) => {
        if (a.pickupDate === b.pickupDate) {
          return a.pickupTimeWindowStart.localeCompare(b.pickupTimeWindowStart);
        }
        return a.pickupDate.localeCompare(b.pickupDate);
      });

      return {
        ...mapTrip(row),
        hasAcceptedPackages: offers.length > 0,
        acceptedPackagesCount: offers.length,
        packages,
      };
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
        acceptedPackagesCount: row._count.offers,
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

    async countAvailableCarriersNear(params: AvailableCarriersParams): Promise<number> {
      // El segmento cambia por cada viaje: el prefiltro SQL descarta los viajes que no
      // pueden pasar cerca del retiro, y `distanceToSegmentKm` afina en memoria. Corre en
      // cada `createShipment`, antes de la llamada a pricing.
      const rows = await db.trip.findMany({
        where: {
          status: { in: [TripStatus.DECLARED, TripStatus.ACTIVE] },
          departureAt: { gte: params.departureFrom, lte: params.departureTo },
          AND: tripCorridorContainsPointWhere(params.lat, params.lng, params.radiusKm),
        },
        select: { carrierId: true, originLat: true, originLng: true, destinationLat: true, destinationLng: true },
      });

      const carriers = new Set<string>();
      for (const row of rows) {
        const distanceKm = distanceToSegmentKm(
          params.lat,
          params.lng,
          Number(row.originLat),
          Number(row.originLng),
          Number(row.destinationLat),
          Number(row.destinationLng)
        );
        if (distanceKm <= params.radiusKm) {
          carriers.add(row.carrierId);
        }
      }
      return carriers.size;
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

    async cancelOverdueDeclared(now: Date, limit: number): Promise<string[]> {
      // `active` nunca entra (AC4): el filtro es siempre `status: declared`.
      const where = {
        status: TripStatus.DECLARED,
        departureAt: { lt: now },
        offers: { none: ACCEPTED_OFFER_FILTER },
      };

      const candidates = await db.trip.findMany({
        where,
        select: { id: true },
        orderBy: { departureAt: "asc" },
        take: limit,
      });

      // Compare-and-swap por viaje, re-evaluando el mismo `where`: si entre el SELECT y
      // el UPDATE el transportista lo inició o se le aceptó un paquete, `count` da 0 y
      // se saltea. Queda una ventana mínima contra un `acceptOffer` concurrente que no
      // toca la fila de `trips` -- aceptada, el viaje cancelado igual conserva su
      // historial y el sweep corre cada pocos minutos, no en un hot path.
      const cancelled: string[] = [];
      for (const { id } of candidates) {
        const result = await db.trip.updateMany({
          where: { ...where, id },
          data: { status: TripStatus.CANCELLED },
        });
        if (result.count > 0) cancelled.push(id);
      }
      return cancelled;
    },
  };
}
