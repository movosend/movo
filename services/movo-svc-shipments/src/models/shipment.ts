import { ShipmentStatus } from "@movo/shared";
import { CancellationPenaltyStatus, PackageType, PhotoStage } from "../generated/prisma/client";

export { CancellationPenaltyStatus, PackageType, PhotoStage };

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
  /** MOVO-317: el emisor eligió "Más de 300 cm"; las medidas guardan el tope (300). */
  oversized: boolean;
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
  /** MOVO-138 (ADR-025): `true` si la cotización llevó recargo por alta demanda. Misma
   * foto que `suggestedPriceArs`, nunca se recalcula. `null` = sin cotización o envío
   * anterior a `demand_fuel_routes_v1` -- no equivale a `false`. */
  highDemand: boolean | null;
  agreedPriceArs: number | null;
  paymentMethod: string | null;
  status: ShipmentStatus;
  carrierWithdrawalPending?: boolean;
  carrierWithdrawalPenaltyArs?: number | null;
  lastStatusChangedAt: Date | null;
  deliveredAt: Date | null;
  receiverConfirmationDeadline: Date | null;
  /** MOVO-253: plazo del emisor para elegir otro receptor. Solo significativo en
   * `rejected_by_receiver`; `null` en rechazos anteriores a este cambio. */
  receiverRedesignationDeadline: Date | null;
  /** MOVO-258 (D4): cuándo el barrido marcó el envío `in_transit` para revisión por no
   * haberse entregado a tiempo; `null` = nunca marcado. */
  transitAnomalyFlaggedAt: Date | null;
  /** MOVO-278 (ADR-045): cuándo se le avisó al transportista que el envío marcado pasa a
   * disputa si no confirma la entrega; `null` = nunca avisado. */
  transitAnomalyWarnedAt: Date | null;
  /** MOVO-307 (ADR-047): penalidad que el emisor confirmó al cancelar un `assigned` con menos
   * de 12 h; `null` en toda cancelación sin cargo. */
  cancellationPenaltyArs: number | null;
  /** MOVO-307: `pending` (falta cobrarla), `captured` (se cobró del hold) o `debt` (quedó en la
   * cuenta corriente del emisor). `null` sin penalidad. */
  cancellationPenaltyStatus: CancellationPenaltyStatus | null;
  /** MOVO-26: inicio de la última asignación; el chat solo muestra mensajes desde acá (el admin los ve todos).
   * `null` = sin corte. */
  chatStartedAt: Date | null;
  /** MOVO-253: motivo del último rechazo (`shipment_events.reason`), solo cuando el
   * envío está en `rejected_by_receiver` y la lectura lo cargó (`findById`/
   * `listByUser`) -- `null` en cualquier otro caso. */
  rejectionReason: string | null;
  /** MOVO-275 (ADR-038): quien le pasó la recepción a otra persona con una
   * transferencia completada. Conserva acceso de solo lectura al envío. Solo lo cargan
   * `findById`/`listByUser`; ausente o `null` en el resto de las lecturas. */
  formerReceiverId?: string | null;
  /** MOVO-340: cuándo se completó esa transferencia (el nuevo receptor se sumó al chat).
   * Mismo alcance que `formerReceiverId`. */
  receiverTransferredAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** MOVO-180: entrega estimada (día + franja) de la oferta ganadora, copiada acá al
   * aceptarla (`offer-repository.ts#acceptOffer`) -- `null` hasta ese momento, mismo
   * criterio que `agreedPriceArs`/`carrierId`. */
  estimatedDeliveryDate: Date | null;
  /** "HH:MM:SS", string simple sin anclaje de timezone (ver `Offer.estimatedDeliveryTimeWindowStart`). */
  estimatedDeliveryTimeWindowStart: string | null;
  estimatedDeliveryTimeWindowEnd: string | null;
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
  /** MOVO-317: el emisor eligió "Más de 300 cm"; las medidas guardan el tope (300). */
  oversized: boolean;
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
  /** Distancia (Haversine) del retiro del envío al `originLat`/`originLng` del caller
   * -- siempre presente, `originLat`/`originLng` son obligatorios. */
  pickupDistanceKm: number;
  /** Distancia (Haversine) de la entrega del envío al `destinationLat`/`destinationLng`
   * del caller. `null` cuando el caller no mandó destino -- no tiene un viaje
   * planificado, solo quiere ver envíos cerca de donde está (AC1 original). */
  deliveryDistanceKm: number | null;
  /** `pickupDistanceKm + (deliveryDistanceKm ?? 0)` -- clave de orden (AC3). Sin
   * destino, coincide exactamente con `pickupDistanceKm`. */
  distanceKm: number;
}

/**
 * Proyección de un envío compatible con el viaje declarado de un transportista
 * enriquecido con desvío marginal exacto por OR-Tools (MOVO-219).
 */
export interface MatchedShipment extends AvailableShipment {
  hasMyOffer: boolean;
  debtDiscount: import("@movo/shared").CarrierDebtDiscount | null;
  detourDistanceKm: number;
  detourDurationMinutes: number;
}

export interface CreateShipmentInput {
  senderId: string;
  receiverId: string;
  packageType: PackageType;
  weightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  /** MOVO-317: el emisor eligió "Más de 300 cm"; las medidas guardan el tope (300). */
  oversized?: boolean;
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
  highDemand: boolean | null;
  receiverConfirmationDeadline?: Date | null;
  /** MOVO-325: ciudad del retiro/entrega (reverse geocoding), `null`/ausente si no se pudo resolver. */
  pickupCity?: string | null;
  deliveryCity?: string | null;
}

export interface ShipmentEvent {
  id: string;
  shipmentId: string;
  fromStatus: ShipmentStatus | null;
  toStatus: ShipmentStatus;
  actorId: string | null;
  assignmentCarrierId?: string | null;
  reason: string | null;
  /** MOVO-331: `normal` salvo que lo haya hecho un admin desde el panel. */
  kind: "normal" | "manual" | "forced";
  actorName: string | null;
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
