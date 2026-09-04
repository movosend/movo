import { OfferStatus, ShipmentStatus } from "@movo/shared";
import { InvalidEnumValueError } from "./shipment";

/**
 * Modelo de dominio de una oferta. `status` es el valor EFECTIVO (AC11): la
 * expiración perezosa ya está aplicada por `deriveEffectiveOfferStatus` en
 * cada mapeo de lectura del repositorio — nunca es el valor crudo de la
 * columna sin evaluar contra `expiresAt`.
 */
export interface Offer {
  id: string;
  shipmentId: string;
  carrierId: string;
  priceOffered: number;
  offeredDate: Date;
  message: string | null;
  carrierRatingAtOffer: number | null;
  carrierNameAtOffer: string | null;
  status: OfferStatus;
  expiresAt: Date | null;
  createdAt: Date;
  respondedAt: Date | null;
  /** MOVO-162: viaje declarado (`shipments.trips`) del que esta oferta forma parte,
   * si el transportista ofertó desde ese contexto -- `null` en el caso general (la
   * mayoría de las ofertas no vienen de un viaje declarado, ver MOVO-142). Único dato
   * que le permite a `Trip.hasAcceptedPackages` (`trip-repository.ts`) saber a cuál de
   * los viajes de un transportista pertenece una oferta aceptada. */
  tripId: string | null;
}

/**
 * MOVO-145: contexto mínimo del envío embebido en cada ítem de `GET /offers/mine`
 * (AC4) — resuelto con un `include` de Prisma en la misma query del repositorio,
 * nunca con una llamada por ítem. Subconjunto de `Shipment` (`./shipment.ts`), no el
 * modelo completo: solo lo que la lista necesita para entenderse sin abrir el detalle.
 */
export interface OfferShipmentContext {
  id: string;
  status: ShipmentStatus;
  pickupAddress: string;
  pickupDate: Date;
  deliveryAddress: string;
}

export interface OfferWithShipmentContext extends Offer {
  shipment: OfferShipmentContext;
}

export interface CreateOfferInput {
  shipmentId: string;
  // AC12: quien llama (futura capa HTTP, tipo MOVO-80) lo resuelve desde el
  // header x-user-id inyectado por el gateway — este input no sabe de
  // headers, solo recibe el id ya resuelto.
  carrierId: string;
  priceOffered: number;
  offeredDate: Date;
  message?: string;
  expiresAt?: Date | null;
  carrierRatingAtOffer?: number | null;
  carrierNameAtOffer?: string | null;
  /** MOVO-162: id de un viaje `active` del propio `carrierId` -- validado por
   * `shipments.service.ts#createOfferForShipment` antes de llegar acá (existencia,
   * pertenencia, estado), no por el repositorio. */
  tripId?: string | null;
}

const OFFER_STATUS_VALUES: ReadonlySet<string> = new Set(Object.values(OfferStatus));

/**
 * Un valor leído de la columna `status` sin equivalente en `@movo/shared` es
 * drift de schema, no un fallo transitorio — mismo patrón que
 * `parseShipmentStatus` (`./shipment.ts`), reusando la misma clase de error
 * (`InvalidEnumValueError` es genérica: `column`/`value`, no acoplada a
 * envíos).
 */
export function parseOfferStatus(value: string, column = "status"): OfferStatus {
  if (!OFFER_STATUS_VALUES.has(value)) {
    throw new InvalidEnumValueError(column, value);
  }
  return value as OfferStatus;
}

/**
 * AC11: expiración perezosa. Si la oferta sigue `pending` en base pero
 * `expiresAt` ya pasó, se reporta `expired` en TODA lectura, sin tocar la
 * fila — no hay scheduler en el stack y este ticket no introduce uno.
 * Usado tanto por los mapeadores de lectura del repositorio como por el
 * pre-chequeo de `acceptOffer`/`reject`/`withdraw` (para que no se pueda
 * responder algo que ya venció, aunque el UPDATE físico a `expired` nunca
 * vaya a correr).
 */
export function deriveEffectiveOfferStatus(
  status: OfferStatus,
  expiresAt: Date | null,
  now: Date = new Date(),
): OfferStatus {
  if (status === OfferStatus.PENDING && expiresAt !== null && expiresAt.getTime() < now.getTime()) {
    return OfferStatus.EXPIRED;
  }
  return status;
}
