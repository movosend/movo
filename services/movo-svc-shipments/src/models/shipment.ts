import { ShipmentStatus } from "@movo/shared";
import { PackageType, PhotoStage } from "../generated/prisma/client";

export { PackageType, PhotoStage };

/**
 * Modelo de dominio de un envío. `status` está alineado 1:1 con
 * `ShipmentStatus` de `@movo/shared` (MOVO-104/MOVO-105) — `PackageType`/
 * `PhotoStage` no tienen consumidor cross-servicio todavía, así que se
 * reusan directo del cliente Prisma generado en vez de duplicarlos acá
 * (mismo criterio incremental que `UserRole`/`KycStatus` en `svc-users`
 * antes de que el mobile los necesitara).
 */
export interface Shipment {
  id: string;
  senderId: string;
  receiverId: string;
  carrierId: string | null;
  packageType: PackageType;
  weightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  description: string | null;
  urgent: boolean;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  deliveryAddress: string;
  deliveryLat: number;
  deliveryLng: number;
  pickupDate: Date;
  pickupTimeWindowStart: Date;
  pickupTimeWindowEnd: Date;
  /** `null` = "precio a estimar" (MOVO-82 AC6): `movo-svc-pricing-logistics` no
   * respondió o faltaban datos al momento de crear el envío. Nunca se recalcula
   * retroactivamente (AC8). */
  suggestedPriceArs: number | null;
  /** Versión del algoritmo que produjo `suggestedPriceArs` (`PriceCalculationMethod`
   * de `@movo/shared`), o `null` junto con un `suggestedPriceArs` nulo. */
  calculationMethod: string | null;
  agreedPriceArs: number | null;
  paymentMethod: string | null;
  status: ShipmentStatus;
  lastStatusChangedAt: Date | null;
  deliveredAt: Date | null;
  receiverConfirmationDeadline: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * MOVO-142 (AC9): proyección de `GET /shipments/available` -- deliberadamente sin
 * `senderId`/`receiverId`/`carrierId` ni datos de precio acordado/pago (irrelevantes
 * antes de asignar), a diferencia de `Shipment`. La ausencia de esos campos en el tipo
 * es lo que garantiza que nunca se filtren por accidente al DTO de ruta, en vez de
 * depender de que el mapeo "se acuerde" de omitirlos.
 */
export interface AvailableShipment {
  id: string;
  packageType: PackageType;
  weightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  description: string | null;
  urgent: boolean;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  deliveryAddress: string;
  deliveryLat: number;
  deliveryLng: number;
  pickupDate: Date;
  pickupTimeWindowStart: Date;
  pickupTimeWindowEnd: Date;
  suggestedPriceArs: number | null;
  calculationMethod: string | null;
  status: ShipmentStatus;
  createdAt: Date;
  /** Distancia (Haversine) del retiro del envío al `originLat`/`originLng` del caller. */
  pickupDistanceKm: number;
  /** Distancia (Haversine) de la entrega del envío al `destinationLat`/`destinationLng` del caller. */
  deliveryDistanceKm: number;
  /** `pickupDistanceKm + deliveryDistanceKm` -- clave de orden (AC3). */
  distanceKm: number;
}

export interface CreateShipmentInput {
  senderId: string;
  receiverId: string;
  packageType: PackageType;
  weightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  description?: string;
  urgent?: boolean;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  deliveryAddress: string;
  deliveryLat: number;
  deliveryLng: number;
  pickupDate: Date;
  pickupTimeWindowStart: Date;
  pickupTimeWindowEnd: Date;
  suggestedPriceArs: number | null;
  calculationMethod: string | null;
  receiverConfirmationDeadline?: Date | null;
}

export interface ShipmentEvent {
  id: string;
  shipmentId: string;
  fromStatus: ShipmentStatus | null;
  toStatus: ShipmentStatus;
  actorId: string | null;
  reason: string | null;
  createdAt: Date;
}

export interface ShipmentPhoto {
  id: string;
  shipmentId: string;
  stage: PhotoStage;
  s3Key: string;
  createdAt: Date;
}

/**
 * Un valor leído de la columna `status` no tiene equivalente en
 * `@movo/shared`. Es drift de schema (alguien agregó un valor al enum de
 * Postgres sin agregarlo a `ShipmentStatus`), no un fallo transitorio —
 * mismo patrón que `InvalidEnumValueError` en `movo-svc-users/src/models/user.ts`.
 */
export class InvalidEnumValueError extends Error {
  constructor(
    public readonly column: string,
    public readonly value: string,
  ) {
    super(`Valor inesperado '${value}' en la columna '${column}': no existe en @movo/shared`);
    this.name = "InvalidEnumValueError";
  }
}

const SHIPMENT_STATUS_VALUES: ReadonlySet<string> = new Set(Object.values(ShipmentStatus));

export function parseShipmentStatus(value: string, column = "status"): ShipmentStatus {
  if (!SHIPMENT_STATUS_VALUES.has(value)) {
    throw new InvalidEnumValueError(column, value);
  }
  return value as ShipmentStatus;
}
