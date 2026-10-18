import { TripStatus, ShipmentStatus } from "@movo/shared";
import { Trip as TripRow } from "../generated/prisma/client";
import { InvalidEnumValueError } from "./shipment";

export { TripStatus };

/**
 * Modelo de dominio de un viaje declarado por un transportista.
 * MOVO-161: usado para matching geométrico de paquetes en corredor (MOVO-50).
 */
export interface Trip {
  id: string;
  carrierId: string;
  originAddress: string;
  originLat: number;
  originLng: number;
  destinationAddress: string;
  destinationLat: number;
  destinationLng: number;
  departureAt: Date;
  vehicleType: string;
  status: TripStatus;
  cancelledAt: Date | null;
  /** MOVO-265 (ADR-042): días en que se repite (0 = domingo … 6 = sábado), `null` = no se repite. */
  recurrenceWeekdays: number[] | null;
  /** Último día de la serie (`"YYYY-MM-DD"`, inclusive, calendario argentino). */
  recurrenceUntil: string | null;
  seriesId: string | null;
  generatedFromTripId: string | null;
  /** Trip vigente de su serie: nadie lo referencia como `generatedFromTripId`. `true` también
   * en un trip no recurrente. Solo el vigente admite editar la recurrencia. */
  isSeriesHead: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** MOVO-265: recurrencia de un trip al crearlo o editarlo. `weekdays: null` la apaga. */
export interface TripRecurrenceInput {
  recurrenceWeekdays?: number[] | null;
  recurrenceUntil?: string | null;
}

export interface CreateTripInput {
  carrierId: string;
  originAddress: string;
  originLat: number;
  originLng: number;
  destinationAddress: string;
  destinationLat: number;
  destinationLng: number;
  departureAt: Date;
  vehicleType: string;
  /** MOVO-265: solo cuando el trip nace recurrente. Sin `id`, lo genera Postgres. */
  id?: string;
  recurrenceWeekdays?: number[] | null;
  recurrenceUntil?: string | null;
  seriesId?: string | null;
  generatedFromTripId?: string | null;
}

export interface UpdateTripInput extends TripRecurrenceInput {
  originAddress?: string;
  originLat?: number;
  originLng?: number;
  destinationAddress?: string;
  destinationLat?: number;
  destinationLng?: number;
  departureAt?: Date;
  vehicleType?: string;
}

export interface TripAcceptedPackage {
  shipmentId: string;
  status: ShipmentStatus;
  packageType: string;
  weightKg: number;
  pickupAddress: string;
  /** Coordenadas del retiro/entrega (MOVO-263): el detalle del viaje dibuja los marcadores. */
  pickupLat: number;
  pickupLng: number;
  deliveryAddress: string;
  deliveryLat: number;
  deliveryLng: number;
  pickupDate: string;
  pickupTimeWindowStart: string;
  pickupTimeWindowEnd: string;
  agreedPriceArs: number;
  senderId: string;
  senderName: string;
  /** Foto actual del emisor (la resuelve `getTrip` contra svc-users); `null` si no tiene o no se pudo leer. */
  senderPhotoUrl: string | null;
}

export interface TripWithAcceptedPackages extends Trip {
  hasAcceptedPackages: boolean;
  acceptedPackagesCount: number;
  /**
   * MOVO-277: cuántos de los paquetes aceptados el viaje puede ejecutar ya
   * (`TRIP_EXECUTABLE_SHIPMENT_STATUSES`). `start()` exige al menos uno; el mobile lo usa
   * para no ofrecer "Iniciar viaje" mientras todos esperan el pago.
   */
  executablePackagesCount: number;
  packages?: TripAcceptedPackage[];
}

const TRIP_STATUS_VALUES: ReadonlySet<string> = new Set(Object.values(TripStatus));

export function parseTripStatus(value: string, column = "status"): TripStatus {
  if (!TRIP_STATUS_VALUES.has(value)) {
    throw new InvalidEnumValueError(column, value);
  }
  return value as TripStatus;
}

/**
 * MOVO-234 (fix de review, PR #176): única fuente de verdad de cómo un
 * `CreateTripInput` se traduce al `data` de `trip.create()` (siempre `declared`,
 * MOVO-221). Antes `offer-repository.ts#acceptOffer` reimplementaba este mapeo
 * inline para el `Trip` auto-creado al aceptar una oferta sin viaje asociado, en vez
 * de reusar el mismo camino que `trip-repository.ts#create()` -- riesgo de que un
 * campo nuevo se agregara a un lado y no al otro sin que nada lo detectara. Ambos
 * ahora arman el `data:` de Prisma a partir de esta única función; lo que NO se
 * comparte es el `db.trip.create()`/`tx.trip.create()` en sí, porque `acceptOffer`
 * necesita ejecutarlo dentro de su propia transacción (`tx`), no anidable con el
 * `TripRepository` que solo opera sobre el `PrismaClient` de nivel superior.
 */
export function buildTripCreateData(input: CreateTripInput): {
  id?: string;
  carrierId: string;
  originAddress: string;
  originLat: number;
  originLng: number;
  destinationAddress: string;
  destinationLat: number;
  destinationLng: number;
  departureAt: Date;
  vehicleType: string;
  status: TripStatus;
  recurrenceWeekdays: number[];
  recurrenceUntil: Date | null;
  seriesId: string | null;
  generatedFromTripId: string | null;
} {
  return {
    ...(input.id ? { id: input.id } : {}),
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
    recurrenceWeekdays: input.recurrenceWeekdays ?? [],
    recurrenceUntil: toRecurrenceUntilColumn(input.recurrenceUntil ?? null),
    seriesId: input.seriesId ?? null,
    generatedFromTripId: input.generatedFromTripId ?? null,
  };
}

/** `"YYYY-MM-DD"` → `Date` anclado a medianoche UTC, como el resto de las columnas `@db.Date`. */
export function toRecurrenceUntilColumn(until: string | null): Date | null {
  return until === null ? null : new Date(`${until}T00:00:00.000Z`);
}

/**
 * MOVO-265: `isSeriesHead` sale de la relación inversa `successor`. Toda query de `Trip` que
 * pase por `mapTrip` incluye este `select`; sin él no se sabría si el trip tiene sucesor.
 */
export const TRIP_SERIES_INCLUDE = { successor: { select: { id: true } } } as const;

export function mapTrip(row: TripRow & { successor: { id: string } | null }): Trip {
  return {
    id: row.id,
    carrierId: row.carrierId,
    originAddress: row.originAddress,
    originLat: row.originLat.toNumber(),
    originLng: row.originLng.toNumber(),
    destinationAddress: row.destinationAddress,
    destinationLat: row.destinationLat.toNumber(),
    destinationLng: row.destinationLng.toNumber(),
    departureAt: row.departureAt,
    vehicleType: row.vehicleType,
    status: parseTripStatus(row.status),
    cancelledAt: row.cancelledAt,
    recurrenceWeekdays: row.recurrenceWeekdays.length > 0 ? row.recurrenceWeekdays : null,
    // `@db.Date` anclada a medianoche UTC (mismo gotcha que `pickupDate`, MOVO-80).
    recurrenceUntil: row.recurrenceUntil ? row.recurrenceUntil.toISOString().slice(0, 10) : null,
    seriesId: row.seriesId,
    generatedFromTripId: row.generatedFromTripId,
    isSeriesHead: row.successor === null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
