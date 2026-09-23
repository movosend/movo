import {
  ActiveShipmentStatus,
  ApiError,
  CarrierRoute,
  OfferStatus,
  PublicProfile,
  ShipmentStatus,
  TripStatus,
  UserRole,
  computeOfferGrossPrice,
  computeNetFromGross,
  getCommissionConfig,
  renderNotificationTrigger,
  notificationTriggerCategory,
} from "@movo/shared";
import { FastifyBaseLogger } from "fastify";
import { ShipmentRepository } from "../../repositories/shipment-repository";
import { OfferRepository } from "../../repositories/offer-repository";
import { TripRepository } from "../../repositories/trip-repository";
import { Trip } from "../../models/trip";
import { RatingRepository } from "../../repositories/rating-repository";
import { UsersClient } from "../../adapters/users-client";
import { NotificationsClient } from "../../adapters/notifications-client";
import { PricingClient } from "../../adapters/pricing-client";
import { PricingLogisticsClient } from "../../adapters/pricing-logistics-client";
import { AvailableShipment, PackageType, Shipment, ShipmentEvent } from "../../models/shipment";
import { RatingRole } from "../../models/rating";
import { isPickupWindowExpired, offerExpiresAtInstant, pickupWindowInstant } from "../../domain/pickup-window";
import { haversineKm } from "../../domain/geo";
import {
  aggregateCarrierStops,
  buildDegradedRoute,
  buildEmptyRoute,
  mapOptimizedRoute,
} from "../../domain/carrier-route";
import {
  ActiveShipmentRole,
  getInitials,
  isActiveShipmentPickupWindowExpired,
  isShipmentPickupToday,
  resolveActiveShipmentCounterpartyId,
} from "../../domain/active-shipment";
import { computePendingRatingFor } from "../../domain/pending-rating";
import {
  RATING_WINDOW_HOURS,
  MAX_DISPUTE_FREEZE_HOURS,
  computeRatingWindowDeadline,
} from "../../domain/rating-window";
import { Offer } from "../../models/offer";
import {
  assertIsNotShipmentParty,
  assertIsReceiver,
  assertIsSenderOrAdmin,
  assertShipmentAccess,
} from "./assert-shipment-access";
import { assertTripAccess } from "../trips/trip-access";

type ShipmentsServiceLogger =
  | FastifyBaseLogger
  | { info?: (obj: unknown, msg?: string) => void; warn: (obj: unknown, msg?: string) => void; error?: (obj: unknown, msg?: string) => void };

interface NewOfferPushParams {
  senderId: string;
  carrierName: string | null;
  deliveryShort: string;
  shipmentId: string;
  offerId: string;
}

/** AC9 de MOVO-143: push al emisor cuando recibe una oferta nueva, mismo patrón
 * try/catch + `logger?.warn` que `dispatchOfferPush` en `offers.service.ts` (MOVO-144)
 * -- no se extrae a un helper compartido porque el payload difiere (acá el
 * destinatario es el emisor, no el transportista). */
async function dispatchNewOfferPush(
  notificationsClient: NotificationsClient | undefined,
  logger: ShipmentsServiceLogger | undefined,
  params: NewOfferPushParams
): Promise<void> {
  if (!notificationsClient) {
    return;
  }
  try {
    const { title, body } = renderNotificationTrigger("offerCreated", {
      carrierName: params.carrierName,
      deliveryShort: params.deliveryShort,
    });
    await notificationsClient.sendPush({
      userId: params.senderId,
      title,
      body,
      category: notificationTriggerCategory("offerCreated"),
      data: { type: "offer_created", shipmentId: params.shipmentId, offerId: params.offerId },
    });
  } catch (err) {
    logger?.warn(
      { err, event: "notification_dispatch_failed", shipmentId: params.shipmentId, offerId: params.offerId },
      "No se pudo enviar la push de oferta nueva"
    );
  }
}

export type ListShipmentOffersSort = "price" | "rating" | "createdAt";

export interface ListShipmentOffersQuery {
  sort?: ListShipmentOffersSort;
  includeResolved?: boolean;
}

export interface CreateShipmentServiceInput {
  senderId: string;
  receiverId: string;
  packageType: PackageType;
  weightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  description?: string;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  deliveryAddress: string;
  deliveryLat: number;
  deliveryLng: number;
  /** "YYYY-MM-DD" */
  pickupDate: string;
  /** "HH:MM" o "HH:MM:SS" */
  pickupTimeWindowStart: string;
  pickupTimeWindowEnd: string;
}

export interface ListMineResult {
  items: Shipment[];
  page: number;
  limit: number;
  total: number;
}

export interface ListAvailableShipmentsQuery {
  originLat: number;
  originLng: number;
  /** Opcionales -- sin destino, el filtro/orden es solo contra la cercanía del
   * retiro al origen (AC1 original: el caller no tiene por qué tener un viaje
   * planificado). Ambos o ninguno: mandar uno solo es un 400. */
  destinationLat?: number;
  destinationLng?: number;
  radiusKm: number;
  maxDistanceKm?: number;
  page: number;
  limit: number;
}

export interface CreateOfferForShipmentInput {
  shipmentId: string;
  carrierId: string;
  callerRoles: UserRole[];
  /** NETO que el transportista quiere cobrar (AC6) -- el servidor calcula el bruto. */
  priceNetArs: number;
  /** "YYYY-MM-DD" -- MOVO-177: ya no exige coincidencia exacta con `shipment.pickupDate`
   * (AC5 original), acepta hasta `OFFER_DATE_MAX_FORWARD_OFFSET_DAYS` días después. */
  offeredDate: string;
  /** MOVO-177: franja horaria alternativa de retiro ("HH:MM"), solo cuando el
   * transportista propone un día/horario distinto al pedido -- both o ninguno. */
  offeredPickupTimeWindowStart?: string;
  offeredPickupTimeWindowEnd?: string;
  message?: string;
  /** MOVO-162: viaje declarado (activo, del propio `carrierId`) del que esta oferta
   * forma parte -- opcional, la mayoría de las ofertas no vienen de un viaje
   * declarado (MOVO-142, descubrimiento libre). */
  tripId?: string;
  /** MOVO-180: entrega estimada (día + franja) -- opcional (el mobile todavía no la
   * recolecta), los tres both-or-neither, `estimatedDeliveryTimeWindowEnd` >
   * `estimatedDeliveryTimeWindowStart`, y `estimatedDeliveryDate` >= `offeredDate` (no
   * tiene sentido entregar antes de retirar). "YYYY-MM-DD". */
  estimatedDeliveryDate?: string;
  /** "HH:MM" o "HH:MM:SS". */
  estimatedDeliveryTimeWindowStart?: string;
  estimatedDeliveryTimeWindowEnd?: string;
}

export interface CreateOfferForShipmentResult extends Offer {
  priceNetArs: number;
  commissionAmountArs: number;
}

/**
 * MOVO-180 (adelantado): agregado de las ofertas vigentes de un envío, para que un
 * transportista que todavía no ofertó sepa contra quién compite -- SIN exponer
 * identidad de los competidores (nombre/id/rating), a diferencia de
 * `listShipmentOffers` (`GET /shipments/:id/offers`, restringido al emisor/admin,
 * `assertIsSenderOrAdmin`). `null` si el envío no tiene ninguna oferta pending
 * vigente.
 */
export interface ShipmentOffersSummary {
  count: number;
  /** NETO más bajo entre las ofertas vigentes (lo que el otro transportista pidió
   * cobrar) -- se deriva del `priceOffered` (bruto, lo único que persiste `Offer`)
   * con la misma tasa de comisión que `computeOfferGrossPrice`, nunca un valor
   * guardado aparte. */
  minPriceNetArs: number;
}

export type ShipmentDetailResult = Shipment & { offersSummary?: ShipmentOffersSummary | null };

export interface ListAvailableResult {
  items: Array<AvailableShipment & { hasMyOffer: boolean }>;
  page: number;
  limit: number;
  total: number;
}

/**
 * MOVO-192: resultado interno de `listActiveShipments` -- fechas/horas siguen siendo
 * `Date` acá (mismo criterio que `Shipment`), la ruta las formatea a string con
 * `toActiveShipmentDto` (mismo fix de timezone que `toShipmentDto`, ver su comentario
 * en `shipments.routes.ts`). `status` se acota a `ActiveShipmentStatus` (no todo
 * `ShipmentStatus`) porque `repository.listActiveShipments` ya filtra por
 * `ACTIVE_SHIPMENT_STATUSES` -- el cast en el mapeo documenta esa garantía, no la
 * reimplementa.
 */
export interface ActiveShipmentResult {
  id: string;
  status: ActiveShipmentStatus;
  pickupDate: Date;
  pickupTimeWindowStart: Date;
  pickupTimeWindowEnd: Date;
  pickupAddress: string;
  deliveryAddress: string;
  agreedPriceArs: number | null;
  counterparty: { name: string; initials: string };
  isToday: boolean;
  pickupWindowExpired: boolean;
}

const ACTIVE_SHIPMENT_ROLE_TO_COLUMN: Record<ActiveShipmentRole, "senderId" | "carrierId" | "receiverId"> = {
  sending: "senderId",
  transporting: "carrierId",
  receiving: "receiverId",
};

/**
 * MOVO-222: resultado interno de `listPendingRatings` -- `deliveredAt` sigue siendo
 * `Date` acá (mismo criterio que `Shipment`/`ActiveShipmentResult`), la ruta lo
 * formatea a string. `status` se acota a los dos valores "fulfilled" porque
 * `repository.findPendingRatingCandidates` ya filtró por
 * `FULFILLED_SHIPMENT_STATUSES` -- el cast en el mapeo documenta esa garantía, no la
 * reimplementa.
 */
export interface PendingRatingResult {
  id: string;
  status: ShipmentStatus.DELIVERED | ShipmentStatus.COMPLETED;
  deliveredAt: Date;
  ratingDeadline: Date;
  senderId: string;
  receiverId: string;
  carrierId: string;
  pendingRatingFor: RatingRole[];
}

// Fallback cuando `usersClient.findPublicProfile` de la contraparte falla o devuelve
// null -- no debería pasar en la práctica (la contraparte es siempre alguien que ya
// participó de una asignación real), pero un fallo de red no puede tirar abajo la
// lista completa de envíos activos del caller (mismo criterio best-effort que
// `resolveSnapshotProfile`/`dispatchReceiverDecisionPush` más arriba en este archivo).
const UNKNOWN_COUNTERPARTY_NAME = "Usuario de Movo";

// MOVO-126: retiro y entrega a menos de 100m se tratan como la misma ubicación —
// umbral chico a propósito (mismo criterio que el rechazo duro de
// SHIPMENT_RECEIVER_IS_SENDER, un caso que nunca tiene sentido de negocio), no
// pensado para descartar casos legítimos como "de mi depto a la portería del mismo
// edificio".
const MIN_PICKUP_DELIVERY_DISTANCE_KM = 0.1;

/** "HH:MM" -> "HH:MM:00"; "HH:MM:SS" queda igual.
 * Exportada: `offers.service.ts#updateOffer` (MOVO-181) revalida la franja horaria
 * propuesta con el mismo criterio que `createOfferForShipment`, sin duplicarlo. */
export function normalizeTime(time: string): string {
  return time.length === 5 ? `${time}:00` : time;
}

/** Fecha+hora real (para comparar contra "ahora" y validar la franja).
 * Exportada: mismo motivo que `normalizeTime`. */
export function combineDateAndTime(dateStr: string, timeStr: string): Date {
  return new Date(`${dateStr}T${normalizeTime(timeStr)}.000Z`);
}

// La app opera solo en Argentina (mismo criterio que el regex de teléfono/país
// hardcodeado en address) — sin DST, por lo que el offset es constante.
const ARGENTINA_UTC_OFFSET_HOURS = 3;

/**
 * `combineDateAndTime` ancla el valor de calendario/reloj de pared (hora local
 * argentina) como si fuera UTC -- correcto para persistir (ver `toEpochTime`/nota de
 * MOVO-80 en CLAUDE.md), pero incorrecto para comparar contra un instante real como
 * `new Date()`. Sin este ajuste, "está en el pasado" queda desfasado exactamente el
 * offset de Argentina (UTC-3): un horario todavía futuro en hora local argentina
 * podía rechazarse como pasado. Convierte el valor anclado al instante UTC real que
 * representa esa hora de pared en Argentina.
 */
function toRealInstant(anchoredDate: Date): Date {
  return new Date(anchoredDate.getTime() + ARGENTINA_UTC_OFFSET_HOURS * 60 * 60 * 1000);
}

/** Hora sobre la fecha epoch 1970-01-01 — mismo formato que ya usan las columnas
 * `@db.Time` del repositorio (ver shipment-repository.integration.test.ts). */
function toEpochTime(timeStr: string): Date {
  return new Date(`1970-01-01T${normalizeTime(timeStr)}.000Z`);
}

/** Ancla un `"YYYY-MM-DD"` a medianoche UTC — mismo valor de calendario que
 * persisten las columnas `@db.Date` (pickupDate/offeredDate/estimatedDeliveryDate).
 * Un solo lugar para este anclaje: el historial de MOVO-80 mostró que repetirlo
 * inline en cada call site deja el próximo fix de zona horaria escondido en varios
 * literales casi idénticos.
 * Exportada: mismo motivo que `normalizeTime`/`combineDateAndTime` (MOVO-181). */
export function anchorDateUtc(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

/**
 * MOVO-142 (AC6): gate de "transportista verificado" para `GET /shipments/available` y
 * la apertura de `getShipmentDetail` (AC8). El rol sale del propio header
 * `x-user-roles` (inyectado por el gateway desde el JWT del caller, ADR-010) — no hace
 * falta ninguna llamada a `svc-users` para eso. El KYC de identidad se resuelve con
 * `PublicProfile.isVerified` (`usersClient.findPublicProfile(callerId, callerId)`,
 * mismo campo/patrón que ya usa `createShipment` para el receptor) — `isVerified` ya ES
 * `kycStatusIdentity===approved` del lado de `svc-users`. Deliberadamente NO exige
 * licencia de conducir (MOVO-15): es una insignia de confianza, no un permiso de
 * acceso -- alguien sin auto puede llevar un paquete en micro/tren/avión igual.
 * Chequeo del rol primero (sin I/O) antes de la llamada de red, mismo criterio de
 * "más barato primero" que AC4 de `createShipment`.
 */
async function assertVerifiedCarrier(usersClient: UsersClient, callerId: string, callerRoles: UserRole[]): Promise<void> {
  if (!callerRoles.includes(UserRole.CARRIER)) {
    throw new ApiError(403, "CARRIER_NOT_VERIFIED", "Necesitás ser transportista para ver este contenido.");
  }
  const profile = await usersClient.findPublicProfile(callerId, callerId);
  if (!profile || !profile.isVerified) {
    throw new ApiError(403, "CARRIER_NOT_VERIFIED", "Necesitás tener tu identidad verificada para transportar.");
  }
}

/**
 * AC3 de MOVO-187: resuelve el perfil público de una de las partes de una oferta
 * (transportista o emisor) para snapshotear nombre/verificación al momento de
 * ofertar -- un fallo de `usersClient` no bloquea la creación de la oferta, mismo
 * patrón try/catch+log que `createShipment` ya usa para el nombre del emisor en el
 * copy del push (más arriba en este archivo). `role` es solo para el log, nunca
 * afecta el resultado.
 */
async function resolveSnapshotProfile(
  usersClient: UsersClient,
  userId: string,
  role: "transportista" | "emisor",
  logger?: ShipmentsServiceLogger
) {
  try {
    return await usersClient.findPublicProfile(userId, userId);
  } catch (err) {
    logger?.warn(
      { err, event: "offer_snapshot_profile_lookup_failed", userId, role },
      `No se pudo resolver el perfil del ${role} para el snapshot de la oferta`
    );
    return null;
  }
}

/**
 * Mismo criterio que `resolveSnapshotProfile`, pero para el rating LOCAL
 * (`getCarrierReputationScore`/`getSenderReputationScore`, MOVO-147/187) -- un fallo
 * de `ratingsService.getReputationSummary` (ej. error de DB) tampoco debe bloquear la
 * creación de la oferta, igual que un fallo de `usersClient`. Sin este wrapper, un
 * rechazo acá tiraba abajo el `Promise.all` completo (incluidos los dos snapshots de
 * perfil ya resueltos), contradiciendo el comentario de `createOfferForShipment` y el
 * AC3 de MOVO-187 (señalado en review de PR #150).
 */
async function resolveSnapshotRating(
  getScore: ((userId: string) => Promise<number | null>) | undefined,
  userId: string,
  role: "transportista" | "emisor",
  logger?: ShipmentsServiceLogger
): Promise<number | null> {
  if (!getScore) return null;
  try {
    return await getScore(userId);
  } catch (err) {
    logger?.warn(
      { err, event: "offer_snapshot_rating_lookup_failed", userId, role },
      `No se pudo resolver la reputación del ${role} para el snapshot de la oferta`
    );
    return null;
  }
}

/**
 * MOVO-180 (adelantado): agregado sin identidad para la apertura de descubrimiento de
 * un transportista (`getShipmentDetail`). Reusa `offerRepository.listByShipment` en vez
 * de un método de repositorio nuevo -- un envío tiene pocas ofertas activas, no
 * amerita otra query dedicada solo para el conteo/mínimo. Excluye la oferta propia del
 * `callerId` (fix de review, PR #136): sin esto, un transportista con oferta pendiente
 * que reabre el detalle se cuenta a sí mismo como competencia.
 */
async function computeOffersSummaryForCarrier(
  offerRepository: OfferRepository,
  shipmentId: string,
  callerId: string
): Promise<ShipmentOffersSummary | null> {
  const offers = await offerRepository.listByShipment(shipmentId);
  const pending = offers.filter((offer) => offer.status === OfferStatus.PENDING && offer.carrierId !== callerId);
  if (pending.length === 0) return null;

  const rate = getCommissionConfig().movoCommissionRate;
  const minGrossArs = Math.min(...pending.map((offer) => offer.priceOffered));
  const minPriceNetArs = computeNetFromGross(minGrossArs, rate);
  return { count: pending.length, minPriceNetArs };
}

/**
 * AC4 de MOVO-144: `price` asc por defecto (más barata primero), `rating` desc
 * (mejor reputación primero) y `createdAt` asc (ofertas más viejas primero,
 * consistente con el orden de `createdAt` que ya usa `listByShipment`). Los
 * ratings nulos (transportista sin reseñas todavía) quedan siempre al final,
 * sin importar la dirección del sort — un `null` no es "el peor rating", es
 * la ausencia de uno.
 */
function sortOffers(offers: Offer[], sort: ListShipmentOffersSort): Offer[] {
  const sorted = [...offers];
  switch (sort) {
    case "rating":
      sorted.sort((a, b) => {
        if (a.carrierRatingAtOffer === null) return b.carrierRatingAtOffer === null ? 0 : 1;
        if (b.carrierRatingAtOffer === null) return -1;
        return b.carrierRatingAtOffer - a.carrierRatingAtOffer;
      });
      return sorted;
    case "createdAt":
      sorted.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      return sorted;
    case "price":
    default:
      sorted.sort((a, b) => a.priceOffered - b.priceOffered);
      return sorted;
  }
}

interface ReceiverDecisionPushParams {
  shipment: Shipment;
  callerId: string;
  /** Trigger centralizado (@movo/shared) -- resuelve título/cuerpo/categoría. */
  triggerKey: "shipmentAccepted" | "shipmentRejected";
  /** `data.type` de wire histórico, consumido por `resolveNotificationRoute` del
   * mobile (deep-link de la push) -- deliberadamente distinto del `triggerKey`
   * (no se renombra un valor de wire ya en producción solo por prolijidad interna). */
  type: "shipment_accepted" | "shipment_rejected";
}

async function dispatchReceiverDecisionPush(
  notificationsClient: NotificationsClient,
  usersClient: UsersClient,
  logger: FastifyBaseLogger | { info?: (obj: unknown, msg?: string) => void; warn: (obj: unknown, msg?: string) => void; error: (obj: unknown, msg?: string) => void } | undefined,
  params: ReceiverDecisionPushParams
): Promise<void> {
  try {
    const receiverProfile = await usersClient.findPublicProfile(params.callerId, params.callerId);
    const receiverName = receiverProfile?.fullName ?? "El receptor";
    const { title, body } = renderNotificationTrigger(params.triggerKey, { receiverName });
    await notificationsClient.sendPush({
      userId: params.shipment.senderId,
      title,
      body,
      category: notificationTriggerCategory(params.triggerKey),
      data: { shipmentId: params.shipment.id, type: params.type },
    });
  } catch (err) {
    logger?.warn(
      { err, event: "notification_dispatch_failed", shipmentId: params.shipment.id },
      "No se pudo enviar la push de decisión del receptor"
    );
  }
}

async function dispatchReceiverTimeoutPush(
  notificationsClient: NotificationsClient,
  usersClient: UsersClient,
  logger: FastifyBaseLogger | { info?: (obj: unknown, msg?: string) => void; warn: (obj: unknown, msg?: string) => void; error: (obj: unknown, msg?: string) => void } | undefined,
  shipment: Shipment
): Promise<void> {
  try {
    // El segundo argumento de findPublicProfile es el callerId (quien realiza la consulta).
    // En este contexto el barrido actúa en nombre del emisor (senderId), que es quien
    // recibe la notificación y tiene relación directa con el envío — mismo criterio que
    // dispatchReceiverDecisionPush, donde el callerId es el receptor que tomó la decisión.
    const receiverProfile = await usersClient.findPublicProfile(shipment.receiverId, shipment.senderId);
    const receiverName = receiverProfile?.fullName ?? "El receptor";
    const { title, body } = renderNotificationTrigger("shipmentCancelledConfirmationTimeout", { receiverName });
    await notificationsClient.sendPush({
      userId: shipment.senderId,
      title,
      body,
      category: notificationTriggerCategory("shipmentCancelledConfirmationTimeout"),
      data: { shipmentId: shipment.id, type: "shipment_cancelled" },
    });
  } catch (err) {
    logger?.warn(
      { err, event: "notification_dispatch_failed", shipmentId: shipment.id },
      "No se pudo enviar la push de cancelación por timeout al emisor"
    );
  }
}

/** MOVO-179: primer componente de una dirección ("Av. Colón 1234, Córdoba" ->
 * "Av. Colón 1234") -- sin helper de formato de dirección reusable en el repo
 * todavía, así que queda local a este archivo (consumido por el copy del push de
 * `dispatchTripMatchPushes` y, desde MOVO-245, `dispatchNewOfferPush`). */
function shortAddress(address: string): string {
  return address.split(",")[0].trim();
}

/**
 * MOVO-179 (comentario de Linear, decisión de equipo): el prefiltro geométrico de
 * `findActiveTripsMatchingShipment` puede dar falsos positivos (un envío que "en línea
 * recta" cae en el corredor pero que la ruta real -- calles, sentido -- no lo hace
 * viable) -- exactamente lo que `GET /trips/:id/matches` sí resuelve desde MOVO-219
 * consultando `pricing-logistics`. Se reusa esa misma evaluación acá, pero SOLO sobre
 * los candidatos que ya sobrevivieron el prefiltro geométrico (nunca sobre todos los
 * viajes `active` del sistema) -- evita gastar la cuota de Google Routes en algo que
 * de entrada ni siquiera pasaba el corredor.
 *
 * A diferencia de `getTripMatches` (política No-Fallback: un fallo del servicio de
 * ruteo se propaga como 502/503 al caller HTTP), acá un fallo se trata como "no se
 * pudo confirmar, no se notifica" -- este disparador es best-effort en segundo plano
 * (AC2), no una respuesta que el usuario está esperando en pantalla, así que no tiene
 * sentido que una caída de `pricing-logistics` se propague a ningún lado.
 */
async function evaluateTripMatchFeasibility(
  pricingLogisticsClient: PricingLogisticsClient,
  trip: Trip,
  shipment: Shipment,
  logger: ShipmentsServiceLogger | undefined
): Promise<boolean> {
  try {
    const result = await pricingLogisticsClient.evaluateCandidates({
      trip: {
        id: trip.id,
        originLat: trip.originLat,
        originLng: trip.originLng,
        destinationLat: trip.destinationLat,
        destinationLng: trip.destinationLng,
        departureAt: trip.departureAt.toISOString(),
      },
      candidates: [
        {
          id: shipment.id,
          pickupLat: shipment.pickupLat,
          pickupLng: shipment.pickupLng,
          dropoffLat: shipment.deliveryLat,
          dropoffLng: shipment.deliveryLng,
          pickupWindowStart: pickupWindowInstant(shipment.pickupDate, shipment.pickupTimeWindowStart).toISOString(),
          pickupWindowEnd: pickupWindowInstant(shipment.pickupDate, shipment.pickupTimeWindowEnd).toISOString(),
        },
      ],
    });
    return result.evaluations[0]?.feasible === true;
  } catch (err) {
    logger?.warn(
      { err, event: "trip_match_routing_evaluation_failed", shipmentId: shipment.id, tripId: trip.id },
      "No se pudo evaluar el desvío real del viaje contra pricing-logistics -- se descarta el match sin notificar"
    );
    return false;
  }
}

/**
 * MOVO-179 (AC1-AC5): quinto disparador de `notifications-client.ts` -- al publicarse
 * un envío (`acceptShipment`), avisa a los transportistas con un viaje `active`
 * declarado cuyo corredor contiene tanto el retiro como la entrega del envío (matching
 * inverso de MOVO-161/50, `tripRepository.findActiveTripsMatchingShipment`), y cuya
 * ruta real confirma que el desvío es viable (`evaluateTripMatchFeasibility`, sobre
 * `pricing-logistics`). AC4: de-duplica por `carrierId`, no por `tripId` -- si el mismo
 * transportista matchea con más de un viaje viable, se notifica una sola vez,
 * referenciando el viaje con `departureAt` más próximo (decisión propia, el AC no fija
 * el criterio de desempate). Best-effort por notificación, mismo patrón
 * try/catch+`logger?.warn` que el resto de los disparadores de este archivo -- un
 * fallo de un transportista no frena el resto ni la transición ya commiteada.
 */
async function dispatchTripMatchPushes(
  tripRepository: TripRepository | undefined,
  pricingLogisticsClient: PricingLogisticsClient | undefined,
  notificationsClient: NotificationsClient | undefined,
  logger: ShipmentsServiceLogger | undefined,
  radiusKm: number,
  shipment: Shipment
): Promise<void> {
  if (!tripRepository || !pricingLogisticsClient || !notificationsClient) {
    return;
  }

  try {
    const geometricCandidates = await tripRepository.findActiveTripsMatchingShipment({
      pickupLat: shipment.pickupLat,
      pickupLng: shipment.pickupLng,
      deliveryLat: shipment.deliveryLat,
      deliveryLng: shipment.deliveryLng,
      excludeCarrierIds: [shipment.senderId, shipment.receiverId],
      radiusKm,
    });

    if (geometricCandidates.length === 0) {
      return;
    }

    const feasibility = await Promise.all(
      geometricCandidates.map(async (trip) => ({
        trip,
        feasible: await evaluateTripMatchFeasibility(pricingLogisticsClient, trip, shipment, logger),
      }))
    );
    const feasibleTrips = feasibility.filter((c) => c.feasible).map((c) => c.trip);

    if (feasibleTrips.length === 0) {
      return;
    }

    const sortedByDeparture = [...feasibleTrips].sort(
      (a, b) => a.departureAt.getTime() - b.departureAt.getTime()
    );
    const tripByCarrierId = new Map<string, (typeof sortedByDeparture)[number]>();
    for (const trip of sortedByDeparture) {
      if (!tripByCarrierId.has(trip.carrierId)) {
        tripByCarrierId.set(trip.carrierId, trip);
      }
    }

    await Promise.all(
      [...tripByCarrierId.values()].map(async (trip) => {
        try {
          const { title, body } = renderNotificationTrigger("tripMatch", {
            originShort: shortAddress(trip.originAddress),
            destinationShort: shortAddress(trip.destinationAddress),
          });
          await notificationsClient.sendPush({
            userId: trip.carrierId,
            title,
            body,
            category: notificationTriggerCategory("tripMatch"),
            data: { type: "trip_match", tripId: trip.id, shipmentId: shipment.id },
          });
        } catch (err) {
          logger?.warn(
            { err, event: "notification_dispatch_failed", shipmentId: shipment.id, tripId: trip.id },
            "No se pudo enviar la push de envío compatible con viaje"
          );
        }
      })
    );
  } catch (err) {
    logger?.warn(
      { err, event: "trip_match_dispatch_failed", shipmentId: shipment.id },
      "No se pudo evaluar/despachar las pushes de envío compatible con viaje"
    );
  }
}

/** Aviso al emisor cuando el barrido cancela su envío `published` por vencimiento de
 * la ventana de retiro — mismo patrón que `dispatchReceiverTimeoutPush` (best-effort,
 * nunca revienta el barrido), `type: "shipment_cancelled"` porque el resultado de
 * negocio es el mismo (el envío terminó cancelado), sin importar el motivo. */
async function dispatchPickupExpiredPush(
  notificationsClient: NotificationsClient,
  logger: FastifyBaseLogger | { info?: (obj: unknown, msg?: string) => void; warn: (obj: unknown, msg?: string) => void; error: (obj: unknown, msg?: string) => void } | undefined,
  shipment: Shipment
): Promise<void> {
  try {
    const { title, body } = renderNotificationTrigger("shipmentCancelledPickupExpired", undefined);
    await notificationsClient.sendPush({
      userId: shipment.senderId,
      title,
      body,
      category: notificationTriggerCategory("shipmentCancelledPickupExpired"),
      data: { shipmentId: shipment.id, type: "shipment_cancelled" },
    });
  } catch (err) {
    logger?.warn(
      { err, event: "notification_dispatch_failed", shipmentId: shipment.id },
      "No se pudo enviar la push de cancelación por vencimiento de retiro al emisor"
    );
  }
}

export interface ShipmentsServiceOptions {
  receiverConfirmationTimeoutHours?: number;
  /** Requerido solo para `cancelShipment` (AC7 de MOVO-108, notificar ofertas
   * pendientes) — el barrido de MOVO-130 no lo necesita, nunca cancela por esa vía. */
  offerRepository?: OfferRepository;
  /** Requerido solo para `createShipment` (MOVO-82) — mismo criterio que
   * `offerRepository`: viaja en `opts` en vez de como parámetro posicional propio,
   * para no romper la firma que ya usan `acceptShipment`/`rejectShipment`/el barrido
   * de MOVO-130. Sin cliente inyectado, `createShipment` degrada directo a "precio a
   * estimar" (mismo resultado que si el cliente estuviera pero fallara, AC6). */
  pricingClient?: PricingClient;
  /**
   * Requerido solo para `createOfferForShipment` (MOVO-143, AC7): resuelve
   * `carrierRatingAtOffer` sin HTTP contra sí mismo -- criterio documentado en
   * MOVO-147 (`ratings.service.ts#getReputationSummary` es una llamada local, misma
   * DB/proceso). Inyectado como callback en vez de importar `ratings.service.ts`
   * directo acá para no acoplar este servicio a la construcción completa de
   * `RatingsService` (repositorio + config de reputación), que ya arma
   * `shipments.routes.ts`.
   */
  getCarrierReputationScore?: (carrierId: string) => Promise<number | null>;
  /** Requerido solo para `createOfferForShipment` (MOVO-187): equivalente de
   * `getCarrierReputationScore` para `senderRatingAtOffer` (`getReputationSummary
   * (senderId).asSender.reputationScore`), misma llamada local sin HTTP. */
  getSenderReputationScore?: (senderId: string) => Promise<number | null>;
  /** Requerido solo para `createOfferForShipment` cuando el caller manda `tripId`
   * (MOVO-162) -- valida que el viaje exista, sea del mismo transportista y siga
   * `active` antes de dejar que la oferta lo referencie. */
  tripRepository?: TripRepository;
  /** Requerido para `getMyRoute` (MOVO-206) -- solver de optimización VRPTW. */
  pricingLogisticsClient?: PricingLogisticsClient;
  /**
   * Requerido solo para `listPendingRatings` (MOVO-222) -- resuelve qué calificaciones
   * ya hizo el caller (`listByRaterForShipments`). Sin repositorio inyectado degrada a
   * lista vacía, mismo criterio best-effort que `pricingClient` en `createShipment`:
   * varios tests existentes construyen el servicio sin pasar todas las opciones.
   */
  ratingRepository?: RatingRepository;
  /** MOVO-179: radio de desvío (km) para el matching inverso de `dispatchTripMatchPushes`
   * en `acceptShipment` -- mismo valor (`TRIP_DEFAULT_MAX_DETOUR_KM`) que usa
   * `trips.service.ts#getTripMatches` como default, sin override por viaje (`Trip` no
   * persiste un `radiusKm` propio). Sin este valor inyectado, el trigger no dispara
   * (mismo criterio best-effort/opcional que `tripRepository`). */
  tripMatchDetourRadiusKm?: number;
}

export type ShipmentsService = ReturnType<typeof createShipmentsService>;

export function createShipmentsService(
  repository: ShipmentRepository,
  usersClient: UsersClient,
  notificationsClient?: NotificationsClient,
  logger?: FastifyBaseLogger | { info: (obj: unknown, msg?: string) => void; warn: (obj: unknown, msg?: string) => void; error: (obj: unknown, msg?: string) => void },
  opts: ShipmentsServiceOptions = {}
) {
  const timeoutHours = opts.receiverConfirmationTimeoutHours ?? 48;
  const offerRepository = opts.offerRepository;
  const pricingClient = opts.pricingClient;
  const pricingLogisticsClient = opts.pricingLogisticsClient;
  const getCarrierReputationScore = opts.getCarrierReputationScore;
  const getSenderReputationScore = opts.getSenderReputationScore;
  const tripRepository = opts.tripRepository;
  const ratingRepository = opts.ratingRepository;
  const tripMatchDetourRadiusKm = opts.tripMatchDetourRadiusKm;

  return {
    async createShipment(input: CreateShipmentServiceInput): Promise<Shipment> {
      // AC4 — auto-designación, primero por ser el chequeo más barato (sin I/O).
      if (input.senderId === input.receiverId) {
        throw new ApiError(422, "SHIPMENT_RECEIVER_IS_SENDER", "No podés designarte a vos mismo como receptor.");
      }

      // MOVO-126 — retiro y entrega no pueden ser la misma ubicación, todavía sin I/O.
      const pickupDeliveryDistanceKm = haversineKm(
        input.pickupLat,
        input.pickupLng,
        input.deliveryLat,
        input.deliveryLng
      );
      if (pickupDeliveryDistanceKm < MIN_PICKUP_DELIVERY_DISTANCE_KM) {
        throw new ApiError(
          422,
          "SHIPMENT_PICKUP_DELIVERY_TOO_CLOSE",
          "El retiro y la entrega tienen que estar en ubicaciones distintas."
        );
      }

      // AC6 — validación de fecha/franja, todavía sin I/O.
      const windowStartAt = combineDateAndTime(input.pickupDate, input.pickupTimeWindowStart);
      const windowEndAt = combineDateAndTime(input.pickupDate, input.pickupTimeWindowEnd);
      if (windowEndAt <= windowStartAt) {
        throw new ApiError(
          422,
          "SHIPMENT_PICKUP_WINDOW_INVALID",
          "El fin de la franja de retiro debe ser posterior al inicio."
        );
      }
      if (toRealInstant(windowStartAt) < new Date()) {
        throw new ApiError(422, "SHIPMENT_PICKUP_WINDOW_IN_PAST", "La franja de retiro no puede estar en el pasado.");
      }

      // AC5 — el receptor tiene que existir y tener KYC de identidad aprobado.
      // `PublicProfile.isVerified` ya es exactamente `kycStatusIdentity === APPROVED`
      // del lado de svc-users (models/user-profile.ts#toPublicProfile).
      const receiverProfile = await usersClient.findPublicProfile(input.receiverId, input.senderId);
      if (!receiverProfile) {
        throw new ApiError(404, "USER_NOT_FOUND", "El receptor indicado no existe.");
      }
      if (!receiverProfile.isVerified) {
        throw new ApiError(
          422,
          "SHIPMENT_RECEIVER_KYC_NOT_APPROVED",
          "El receptor todavía no tiene su identidad verificada."
        );
      }

      // MOVO-82: `getQuote` nunca lanza -- degrada a `{ suggestedPriceArs: null,
      // calculationMethod: null }` ("precio a estimar") ante cualquier falla de
      // movo-svc-pricing-logistics (AC6), sin cliente inyectado, o datos incompletos
      // (AC7, inalcanzable hoy porque createShipmentBody exige todos estos campos).
      const quote = pricingClient
        ? await pricingClient.getQuote({
            weightKg: input.weightKg,
            lengthCm: input.lengthCm,
            widthCm: input.widthCm,
            heightCm: input.heightCm,
            packageType: input.packageType,
            originLat: input.pickupLat,
            originLng: input.pickupLng,
            destinationLat: input.deliveryLat,
            destinationLng: input.deliveryLng,
          })
        : { suggestedPriceArs: null, calculationMethod: null };

      if (quote.suggestedPriceArs === null) {
        logger?.warn(
          { event: "pricing_quote_unavailable", senderId: input.senderId },
          "No se pudo obtener un precio sugerido -- el envío se crea con 'precio a estimar'"
        );
      }

      // MOVO-130 AC1 (fix): deadline = min(now + RECEIVER_CONFIRMATION_TIMEOUT_HOURS, pickupDate + pickupTimeWindowEnd).
      // El timeout configurable es el máximo posible, pero si la ventana de retiro cierra antes,
      // se usa ese momento como tope: no tiene sentido que el receptor pueda aceptar un envío
      // cuya ventana de retiro ya cerró. `windowEndAt` viene anclado como reloj de pared
      // argentino (ver `combineDateAndTime`), así que hay que pasarlo por `toRealInstant`
      // antes de compararlo/persistirlo junto a instantes reales como `timeoutDeadline`.
      const timeoutDeadline = new Date(Date.now() + timeoutHours * 60 * 60 * 1000);
      const pickupWindowDeadline = toRealInstant(windowEndAt);
      const receiverConfirmationDeadline =
        timeoutDeadline <= pickupWindowDeadline ? timeoutDeadline : pickupWindowDeadline;

      const created = await repository.create({
        senderId: input.senderId,
        receiverId: input.receiverId,
        packageType: input.packageType,
        weightKg: input.weightKg,
        lengthCm: input.lengthCm,
        widthCm: input.widthCm,
        heightCm: input.heightCm,
        description: input.description,
        pickupAddress: input.pickupAddress,
        pickupLat: input.pickupLat,
        pickupLng: input.pickupLng,
        deliveryAddress: input.deliveryAddress,
        deliveryLat: input.deliveryLat,
        deliveryLng: input.deliveryLng,
        pickupDate: anchorDateUtc(input.pickupDate),
        pickupTimeWindowStart: toEpochTime(input.pickupTimeWindowStart),
        pickupTimeWindowEnd: toEpochTime(input.pickupTimeWindowEnd),
        suggestedPriceArs: quote.suggestedPriceArs,
        calculationMethod: quote.calculationMethod,
        receiverConfirmationDeadline,
      });

      // AC1/AC5 de MOVO-108: best-effort, nunca bloquea la creación ya confirmada.
      // El cliente puede rechazar (notifications-client.ts) -- mismo patrón caller-side
      // try/catch+log que dispatchReceiverDecisionPush (MOVO-129), pero acá sí se espera
      // (no fire-and-forget): no hay razón de negocio para no esperar el intento antes
      // de responder, a diferencia de accept/reject donde la latencia extra no aporta.
      if (notificationsClient) {
        let senderName = "Un usuario";
        try {
          const senderProfile = await usersClient.findPublicProfile(input.senderId, input.senderId);
          if (senderProfile?.fullName) {
            senderName = senderProfile.fullName;
          }
        } catch (err) {
          logger?.warn(
            { err, event: "sender_profile_lookup_for_push_failed", senderId: input.senderId },
            "No se pudo obtener el perfil del emisor para el copy del push; usando fallback"
          );
        }

        try {
          const { title, body } = renderNotificationTrigger("shipmentCreated", { senderName });
          await notificationsClient.sendPush({
            userId: created.receiverId,
            title,
            body,
            category: notificationTriggerCategory("shipmentCreated"),
            data: { type: "shipment", shipmentId: created.id },
          });
        } catch (err) {
          logger?.warn(
            { err, event: "notification_dispatch_failed", shipmentId: created.id },
            "No se pudo notificar al receptor sobre el envío nuevo"
          );
        }
      }

      return created;
    },

    /**
     * AC8 de MOVO-142: amplía la visibilidad de `assertShipmentAccess` (emisor/
     * receptor/admin) con dos casos nuevos, reimplementados acá en vez de tocar ese
     * helper (compartido con `getShipmentEvents`/`photos.service.ts`, fuera del
     * alcance de este ticket, y necesita I/O async que ese helper síncrono no puede
     * intercalar antes del 403 final):
     * - El `carrierId` ya asignado ve su propio envío en cualquier estado (gap real,
     *   `assertShipmentAccess` nunca conoció `carrierId`).
     * - Un transportista verificado (rol `carrier` + KYC de identidad aprobado) ve un
     *   envío `published` ajeno -- la apertura de descubrimiento que necesita
     *   `GET /shipments/available`. Fuera de `published`, el 403 original se mantiene.
     */
    async getShipmentDetail(
      shipmentId: string,
      callerId: string,
      callerRoles: UserRole[]
    ): Promise<ShipmentDetailResult> {
      const shipment = await repository.findById(shipmentId);
      if (!shipment) {
        throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");
      }

      // MOVO-244: si por inconsistencia previa agreedPriceArs es null pero el envío ya tiene
      // transportista asignado, completamos el precio pactado a partir de la oferta aceptada.
      if (shipment.agreedPriceArs === null && shipment.carrierId && offerRepository) {
        const offers = await offerRepository.listByShipment(shipment.id);
        const accepted = offers.find((o) => o.status === OfferStatus.ACCEPTED);
        if (accepted) {
          shipment.agreedPriceArs = accepted.priceOffered;
        }
      }

      if (callerId === shipment.carrierId) {
        return shipment;
      }

      const isParty = callerId === shipment.senderId || callerId === shipment.receiverId;
      const isAdmin = callerRoles.includes(UserRole.ADMIN);
      if (isParty || isAdmin) {
        return shipment;
      }

      if (shipment.status === ShipmentStatus.PUBLISHED) {
        await assertVerifiedCarrier(usersClient, callerId, callerRoles);
        // MOVO-180 (adelantado): agregado de ofertas vigentes para el transportista
        // que está evaluando ofertar -- nunca bloquea la apertura del detalle si
        // falla o si el servicio corre sin `offerRepository` (algún test aislado).
        const offersSummary = offerRepository
          ? await computeOffersSummaryForCarrier(offerRepository, shipmentId, callerId)
          : null;
        return { ...shipment, offersSummary };
      }

      throw new ApiError(403, "AUTH_FORBIDDEN", "No tenés permiso para ver este envío.");
    },

    async getShipmentEvents(shipmentId: string, callerId: string, callerRoles: UserRole[]): Promise<ShipmentEvent[]> {
      const shipment = await repository.findById(shipmentId);
      if (!shipment) {
        throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");
      }

      assertShipmentAccess(shipment, callerId, callerRoles);
      return repository.listEvents(shipmentId);
    },

    /**
     * AC1-AC5 de MOVO-144: lista las ofertas de un envío para el emisor. Usa
     * exclusivamente los snapshots ya guardados en la oferta
     * (`carrierNameAtOffer`/`carrierRatingAtOffer`, MOVO-102) — sin llamar a
     * `svc-users` por cada ítem (AC3). Por defecto solo devuelve ofertas
     * vigentes (`pending` efectivo, post expiración perezosa); `includeResolved`
     * suma las terminales (AC5).
     */
    async listShipmentOffers(
      shipmentId: string,
      callerId: string,
      callerRoles: UserRole[],
      query: ListShipmentOffersQuery = {}
    ): Promise<Offer[]> {
      const shipment = await repository.findById(shipmentId);
      if (!shipment) {
        throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");
      }

      assertIsSenderOrAdmin(shipment, callerId, callerRoles);

      if (!offerRepository) {
        throw new Error("listShipmentOffers requiere offerRepository (ShipmentsServiceOptions).");
      }

      // MOVO-189 (AC1/AC3): "vio la oferta" es una acción del EMISOR, no de un admin
      // que entra a auditar -- solo se marca cuando el caller es el emisor real.
      // Best-effort: un fallo acá nunca bloquea la respuesta 200 con las ofertas
      // (mismo criterio que las notificaciones push no bloqueantes).
      if (callerId === shipment.senderId) {
        try {
          await offerRepository.markPendingOffersViewedBySender(shipmentId);
        } catch (err) {
          logger?.warn(
            { err, event: "offer_viewed_mark_failed", shipmentId },
            "No se pudo marcar las ofertas como vistas por el emisor"
          );
        }
      }

      const offers = await offerRepository.listByShipment(shipmentId);
      // El emisor puede cancelar/el envío puede dejar de aceptar ofertas sin que
      // `cancelShipment` toque las filas de `offers` (solo notifica, ver
      // shipments.service.ts#cancelShipment) — filtrar acá por las ofertas
      // `pending` de un envío que ya no está `published`/`assignment_pending`
      // evita listarlas como vigentes/accionables cuando `POST /offers/:id/accept`
      // ya respondería 409 SHIPMENT_NOT_AVAILABLE_FOR_ASSIGNMENT.
      const shipmentAcceptsOffers =
        shipment.status === ShipmentStatus.PUBLISHED || shipment.status === ShipmentStatus.ASSIGNMENT_PENDING;
      const filtered = query.includeResolved
        ? offers
        : offers.filter((offer) => offer.status === OfferStatus.PENDING && shipmentAcceptsOffers);

      return sortOffers(filtered, query.sort ?? "price");
    },

    /**
     * MOVO-143 (AC1-AC7/AC9): el transportista oferta un precio sobre un envío
     * `published`. Chequeo de rol primero (sin I/O, AC2), después el envío (AC1),
     * después que el caller no sea parte del envío (AC3) — mismo orden "más barato
     * primero" que el resto del servicio. `offer-repository.ts#create()` ya valida
     * `offeredDate` contra `pickupDate` (AC5, `OfferDateOutOfRangeError` -> 422) y la
     * duplicidad de oferta activa (AC4, `DuplicateActiveOfferError` -> 409) — no se
     * reimplementa acá.
     */
    async createOfferForShipment(input: CreateOfferForShipmentInput): Promise<CreateOfferForShipmentResult> {
      if (!offerRepository) {
        throw new Error("createOfferForShipment requiere offerRepository (ShipmentsServiceOptions).");
      }

      await assertVerifiedCarrier(usersClient, input.carrierId, input.callerRoles);

      const shipment = await repository.findById(input.shipmentId);
      if (!shipment) {
        throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");
      }

      // AC1: solo se puede ofertar sobre un envío published.
      if (shipment.status !== ShipmentStatus.PUBLISHED) {
        throw new ApiError(
          409,
          "SHIPMENT_NOT_AVAILABLE_FOR_OFFER",
          "El envío no está disponible para recibir ofertas."
        );
      }

      assertIsNotShipmentParty(shipment, input.carrierId);

      if (input.priceNetArs <= 0) {
        throw new ApiError(422, "VALIDATION_FAILED", "El precio ofertado tiene que ser mayor a 0.");
      }

      // MOVO-177: la franja horaria alternativa de retiro es both-or-neither -- un
      // solo campo presente es un estado a medio construir que el cliente nunca
      // debería poder mandar, así que se lo trata como error de validación en vez de
      // interpretar cuál de los dos "vale".
      const hasOfferedPickupWindowStart = input.offeredPickupTimeWindowStart !== undefined;
      const hasOfferedPickupWindowEnd = input.offeredPickupTimeWindowEnd !== undefined;
      if (hasOfferedPickupWindowStart !== hasOfferedPickupWindowEnd) {
        throw new ApiError(
          422,
          "VALIDATION_FAILED",
          "La franja horaria de retiro propuesta requiere both inicio y fin, o ninguno."
        );
      }
      if (hasOfferedPickupWindowStart && hasOfferedPickupWindowEnd) {
        const offeredWindowStartAt = combineDateAndTime(input.offeredDate, input.offeredPickupTimeWindowStart!);
        const offeredWindowEndAt = combineDateAndTime(input.offeredDate, input.offeredPickupTimeWindowEnd!);
        if (offeredWindowEndAt <= offeredWindowStartAt) {
          throw new ApiError(
            422,
            "OFFER_PICKUP_WINDOW_INVALID",
            "El fin de la franja de retiro propuesta debe ser posterior al inicio."
          );
        }
      }

      // MOVO-180: los tres campos de entrega estimada son opcionales (el mobile
      // todavía no los recolecta), pero both-or-neither -- mandar uno o dos sin el
      // resto es un estado ambiguo. Validación puramente sincrónica, antes de
      // cualquier I/O (mismo criterio "más barato primero" que el resto del método).
      const hasEstimatedDelivery =
        input.estimatedDeliveryDate !== undefined ||
        input.estimatedDeliveryTimeWindowStart !== undefined ||
        input.estimatedDeliveryTimeWindowEnd !== undefined;
      let estimatedDeliveryDate: Date | null = null;
      let estimatedDeliveryTimeWindowStart: string | null = null;
      let estimatedDeliveryTimeWindowEnd: string | null = null;
      if (hasEstimatedDelivery) {
        if (
          input.estimatedDeliveryDate === undefined ||
          input.estimatedDeliveryTimeWindowStart === undefined ||
          input.estimatedDeliveryTimeWindowEnd === undefined
        ) {
          throw new ApiError(
            422,
            "VALIDATION_FAILED",
            "La entrega estimada requiere fecha y franja horaria completas, o ninguna de las tres."
          );
        }
        // Mismo criterio que la franja de retiro (AC6 más arriba): comparar los
        // objetos `Date` combinados, no los strings de horario normalizados.
        const estimatedWindowStartAt = combineDateAndTime(
          input.estimatedDeliveryDate,
          input.estimatedDeliveryTimeWindowStart
        );
        const estimatedWindowEndAt = combineDateAndTime(
          input.estimatedDeliveryDate,
          input.estimatedDeliveryTimeWindowEnd
        );
        if (estimatedWindowEndAt <= estimatedWindowStartAt) {
          throw new ApiError(
            422,
            "VALIDATION_FAILED",
            "La franja de entrega estimada tiene que terminar después de empezar."
          );
        }
        estimatedDeliveryDate = anchorDateUtc(input.estimatedDeliveryDate);
        const offeredDateAnchored = anchorDateUtc(input.offeredDate);
        if (estimatedDeliveryDate.getTime() < offeredDateAnchored.getTime()) {
          throw new ApiError(
            422,
            "VALIDATION_FAILED",
            "La entrega estimada no puede ser anterior a la fecha de retiro ofertada."
          );
        }
        estimatedDeliveryTimeWindowStart = normalizeTime(input.estimatedDeliveryTimeWindowStart);
        estimatedDeliveryTimeWindowEnd = normalizeTime(input.estimatedDeliveryTimeWindowEnd);
      }

      // MOVO-162: tripId opcional -- valida que el viaje exista, sea del mismo
      // transportista y siga disponible antes de dejar que la oferta lo referencie.
      // Sin este chequeo, cualquier caller podría taggear la oferta con el viaje de
      // otro transportista o uno ya cancelado, y Trip.hasAcceptedPackages
      // (trip-repository.ts) perdería sentido. Deliberadamente NO valida que el envío
      // caiga geométricamente dentro del corredor del viaje -- todavía no hay ningún
      // consumidor real que dispare este campo (MOVO-163/MOVO-149 no lo contemplan en
      // su AC), así que esa validación queda para cuando exista ese flujo y se sepa
      // qué radio/semántica espera.
      //
      // MOVO-221: el chequeo original exigía `trip.status === ACTIVE` a secas -- con
      // el rediseño de estados de viaje (declared/active/completed), una oferta se
      // hace normalmente mientras el viaje todavía está `declared` (antes de que el
      // transportista lo arranque, `POST /trips/:id/start`), así que restringir a
      // `active` habría bloqueado el caso normal. Se amplía a "vivo" (declared o
      // active), rechazando solo cancelled/completed -- mismo criterio ya aplicado al
      // gating de `GET /trips/:id/matches` (`trips.service.ts`). `TRIP_NOT_ACTIVE`
      // nunca se renombra (contrato de wire, `@movo/shared`) -- queda sin uso, el
      // reemplazo es el código nuevo `TRIP_NOT_AVAILABLE`.
      if (input.tripId) {
        if (!tripRepository) {
          throw new Error("createOfferForShipment requiere tripRepository (ShipmentsServiceOptions) para validar tripId.");
        }
        const trip = await tripRepository.findById(input.tripId);
        if (!trip) {
          throw new ApiError(404, "TRIP_NOT_FOUND", `El viaje '${input.tripId}' no existe.`);
        }
        // allowAdmin: false -- a diferencia del resto de los usos de assertTripAccess,
        // ofertar es una acción 100% self-service del transportista (input.carrierId
        // siempre es el propio caller, nunca "en nombre de"); un admin no tiene ningún
        // caso de uso legítimo para taggear la oferta de otro con este tripId.
        assertTripAccess(trip, input.carrierId, input.callerRoles, {
          allowAdmin: false,
          forbiddenMessage: "No podés ofertar en nombre de un viaje que no es tuyo.",
        });
        if (trip.status !== TripStatus.DECLARED && trip.status !== TripStatus.ACTIVE) {
          throw new ApiError(
            409,
            "TRIP_NOT_AVAILABLE",
            `El viaje '${input.tripId}' no admite nuevas ofertas en su estado actual ('${trip.status}').`,
          );
        }
      }

      // AC6: el transportista ingresa el NETO, el servidor calcula el BRUTO -- nunca
      // al revés. `computeOfferGrossPrice` es una función pura de `@movo/shared`
      // (misma tasa que usará el split real de movo-svc-payments más adelante, ver
      // shared/movo-shared/src/config/commission.ts).
      const { netArs, commissionAmountArs, grossArs } = computeOfferGrossPrice(input.priceNetArs);

      // AC7 de MOVO-143 / AC1 de MOVO-187: snapshot del transportista y del emisor,
      // resueltos en paralelo. El nombre/verificación de cada uno sigue el mismo
      // criterio cross-servicio que ya usa `createShipment` para el receptor
      // (`usersClient.findPublicProfile`), envuelto en `resolveSnapshotProfile` (AC3
      // de MOVO-187: un fallo de `usersClient` no bloquea la creación de la oferta,
      // mismo patrón try/catch+log ya usado más arriba en `createShipment` para el
      // nombre del emisor en el copy del push -- ANTES de este ticket, el snapshot del
      // transportista no tenía este resguardo: un `usersClient` caído sí bloqueaba la
      // creación pese a lo que ya documentaba este mismo comentario). El rating de
      // cada uno sigue el criterio de MOVO-147 -- llamada LOCAL (misma DB/proceso) vía
      // `getCarrierReputationScore`/`getSenderReputationScore`, envuelto en
      // `resolveSnapshotRating` (mismo try/catch+log que `resolveSnapshotProfile`,
      // sin esto un error de DB dentro de `getReputationSummary` rechazaba el
      // `Promise.all` completo y bloqueaba la oferta -- fix de review, PR #150).
      // Cualquiera de los 4 valores puede resolver `null` (perfil no encontrado, sin
      // calificaciones todavía, o fallo tolerado) -- nunca bloquea la creación de la
      // oferta.
      const [carrierProfile, carrierRatingAtOffer, senderProfile, senderRatingAtOffer] = await Promise.all([
        resolveSnapshotProfile(usersClient, input.carrierId, "transportista", logger),
        resolveSnapshotRating(getCarrierReputationScore, input.carrierId, "transportista", logger),
        resolveSnapshotProfile(usersClient, shipment.senderId, "emisor", logger),
        resolveSnapshotRating(getSenderReputationScore, shipment.senderId, "emisor", logger),
      ]);

      // Bug real encontrado probando "Mis ofertas" en dispositivo (sin ticket
      // propio): `expiresAt` nunca se completaba acá -- quedaba `null` para SIEMPRE
      // (el repositorio lo defaultea a `null` cuando falta, `offer-repository.ts`),
      // así que `deriveEffectiveOfferStatus` (AC11 de MOVO-102, expiración
      // perezosa) nunca podía devolver `expired` sin importar cuánto hubiera pasado
      // la fecha de retiro -- el footer "Las ofertas pendientes se cierran solas..."
      // de MOVO-151 describía un comportamiento que este flujo nunca cableó. Vence
      // cuando cierra la ventana de retiro EFECTIVA de la oferta (`offerExpiresAtInstant`:
      // la franja propuesta si el transportista propuso una, MOVO-177; si no, la del
      // envío tal cual).
      const expiresAt = offerExpiresAtInstant(
        anchorDateUtc(input.offeredDate),
        input.offeredPickupTimeWindowEnd || null,
        shipment.pickupTimeWindowEnd
      );

      const offer = await offerRepository.create({
        shipmentId: input.shipmentId,
        carrierId: input.carrierId,
        priceOffered: grossArs,
        offeredDate: anchorDateUtc(input.offeredDate),
        offeredPickupTimeWindowStart: input.offeredPickupTimeWindowStart ?? null,
        offeredPickupTimeWindowEnd: input.offeredPickupTimeWindowEnd ?? null,
        expiresAt,
        message: input.message,
        tripId: input.tripId ?? null,
        carrierNameAtOffer: carrierProfile?.fullName ?? null,
        carrierRatingAtOffer,
        senderNameAtOffer: senderProfile?.fullName ?? null,
        senderVerifiedAtOffer: senderProfile?.isVerified ?? null,
        senderRatingAtOffer,
        estimatedDeliveryDate,
        estimatedDeliveryTimeWindowStart,
        estimatedDeliveryTimeWindowEnd,
      });

      // AC9: best-effort, fire-and-forget -- un fallo de la notificación no revierte
      // la creación de la oferta (que ya commiteó arriba).
      void dispatchNewOfferPush(notificationsClient, logger, {
        senderId: shipment.senderId,
        carrierName: offer.carrierNameAtOffer,
        deliveryShort: shortAddress(shipment.deliveryAddress),
        shipmentId: shipment.id,
        offerId: offer.id,
      });

      return { ...offer, priceNetArs: netArs, commissionAmountArs };
    },

    async acceptShipment(shipmentId: string, callerId: string): Promise<Shipment> {
      const shipment = await repository.findById(shipmentId);
      if (!shipment) {
        throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");
      }

      assertIsReceiver(shipment, callerId);

      // MOVO-130 AC5: si la deadline venció, 409 aunque el barrido todavía no haya corrido
      if (
        shipment.status === ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION &&
        shipment.receiverConfirmationDeadline &&
        shipment.receiverConfirmationDeadline < new Date()
      ) {
        throw new ApiError(
          409,
          "SHIPMENT_RECEIVER_CONFIRMATION_EXPIRED",
          "El plazo para que el receptor confirme o rechace este envío ha expirado."
        );
      }

      const updated = await repository.updateStatus(shipmentId, ShipmentStatus.PUBLISHED, callerId);

      // Best-effort push notification al emisor (AC9 de MOVO-129): deliberadamente
      // sin await -- el estado ya está commiteado y la push no debe agregar latencia
      // ni poder hacer fallar la respuesta.
      if (notificationsClient) {
        void dispatchReceiverDecisionPush(notificationsClient, usersClient, logger, {
          shipment,
          callerId,
          triggerKey: "shipmentAccepted",
          type: "shipment_accepted",
        });
      }

      // MOVO-179 (AC1/AC5): el trigger es puntual, solo en el momento de la
      // publicación -- vive acá y en ningún otro lugar del ciclo de vida del envío.
      // Best-effort/fire-and-forget, mismo criterio que la push de arriba.
      if (tripMatchDetourRadiusKm !== undefined) {
        void dispatchTripMatchPushes(
          tripRepository,
          pricingLogisticsClient,
          notificationsClient,
          logger,
          tripMatchDetourRadiusKm,
          updated
        );
      }

      return updated;
    },

    async rejectShipment(shipmentId: string, callerId: string, reason?: string): Promise<Shipment> {
      const shipment = await repository.findById(shipmentId);
      if (!shipment) {
        throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");
      }

      assertIsReceiver(shipment, callerId);

      // MOVO-130 AC5: si la deadline venció, 409 aunque el barrido todavía no haya corrido
      if (
        shipment.status === ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION &&
        shipment.receiverConfirmationDeadline &&
        shipment.receiverConfirmationDeadline < new Date()
      ) {
        throw new ApiError(
          409,
          "SHIPMENT_RECEIVER_CONFIRMATION_EXPIRED",
          "El plazo para que el receptor confirme o rechace este envío ha expirado."
        );
      }

      const updated = await repository.updateStatus(shipmentId, ShipmentStatus.REJECTED_BY_RECEIVER, callerId, reason);

      // Best-effort push notification al emisor (AC8 de MOVO-129): deliberadamente
      // sin await -- el estado ya está commiteado y la push no debe agregar latencia
      // ni poder hacer fallar la respuesta.
      if (notificationsClient) {
        void dispatchReceiverDecisionPush(notificationsClient, usersClient, logger, {
          shipment,
          callerId,
          triggerKey: "shipmentRejected",
          type: "shipment_rejected",
        });
      }

      return updated;
    },

    async listMyShipments(userId: string, page: number, limit: number): Promise<ListMineResult> {
      const { items, total } = await repository.listByUser(userId, page, limit);
      return { items, page, limit, total };
    },

    /**
     * MOVO-142: descubrimiento del transportista. Gate primero (AC6, sin gastar la
     * query geográfica si el caller ni siquiera es carrier verificado), después el
     * filtro de radio/AND sobre el trayecto (`repository.listAvailable`), y por
     * último `hasMyOffer` en batch sobre la página ya resuelta (AC5, sin N+1).
     */
    async listAvailableShipments(
      callerId: string,
      callerRoles: UserRole[],
      query: ListAvailableShipmentsQuery
    ): Promise<ListAvailableResult> {
      if (!offerRepository) {
        throw new Error("listAvailableShipments requiere offerRepository (ShipmentsServiceOptions).");
      }
      // El destino es opcional, pero es un par -- mandar uno sin el otro no tiene
      // forma de resolverse (ni bounding box ni Haversine de un solo lado). Chequeo
      // más barato primero, sin I/O, antes del gate de KYC.
      if ((query.destinationLat !== undefined) !== (query.destinationLng !== undefined)) {
        throw new ApiError(
          400,
          "VALIDATION_FAILED",
          "destinationLat y destinationLng van juntos: mandá los dos o ninguno."
        );
      }
      await assertVerifiedCarrier(usersClient, callerId, callerRoles);

      const { items, total } = await repository.listAvailable({
        originLat: query.originLat,
        originLng: query.originLng,
        destinationLat: query.destinationLat,
        destinationLng: query.destinationLng,
        radiusKm: query.radiusKm,
        maxDistanceKm: query.maxDistanceKm,
        excludeUserId: callerId,
        page: query.page,
        limit: query.limit,
      });
      const offeredIds = await offerRepository.listPendingOfferedShipmentIds(
        callerId,
        items.map((item) => item.id)
      );

      return {
        items: items.map((item) => ({ ...item, hasMyOffer: offeredIds.has(item.id) })),
        page: query.page,
        limit: query.limit,
        total,
      };
    },

    /**
     * MOVO-29 (recorte de alcance acordado en MOVO-108, ver comentario en Linear):
     * solo cubre la cancelación sin penalización, desde los tres estados que todavía
     * no tienen fondos confirmados. `svc-payments` hoy es un esqueleto sin holds ni
     * capture reales -- cancelar desde `assigned` (que sí exige aplicar una política
     * de penalización, AC de MOVO-29) queda bloqueado explícitamente más abajo hasta
     * que esa integración exista, en vez de fingir una transición sin su consecuencia
     * de negocio.
     */
    async cancelShipment(shipmentId: string, callerId: string, reason?: string): Promise<Shipment> {
      const shipment = await repository.findById(shipmentId);
      if (!shipment) {
        throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");
      }

      // Solo el emisor puede cancelar -- a diferencia de assertShipmentAccess (lectura,
      // también habilita a receptor/admin), cancelar es una acción exclusiva del emisor.
      if (shipment.senderId !== callerId) {
        throw new ApiError(403, "AUTH_FORBIDDEN", "Solo el emisor puede cancelar este envío.");
      }

      if (shipment.status === ShipmentStatus.ASSIGNED) {
        throw new ApiError(
          409,
          "SHIPMENT_CANCELLATION_PENALTY_NOT_SUPPORTED",
          "No se puede cancelar un envío ya asignado todavía -- la política de penalización no está implementada."
        );
      }

      const previousStatus = shipment.status;
      // Cualquier otro estado sin salida hacia `cancelled` (delivered, in_transit,
      // disputed, cancelled, rejected_by_receiver) llega hasta acá y
      // shipment-state-machine.ts lo rechaza con InvalidShipmentTransitionError
      // (409 SHIPMENT_INVALID_TRANSITION, ver plugins/error-handler.ts).
      const cancelled = await repository.updateStatus(shipmentId, ShipmentStatus.CANCELLED, callerId, reason);

      // AC7 de MOVO-108: solo estos dos estados de origen pueden tener ofertas
      // `pending` colgando (desde `awaiting_receiver_confirmation` el envío ni
      // publicado está, no puede tener ofertas).
      if (previousStatus === ShipmentStatus.PUBLISHED || previousStatus === ShipmentStatus.ASSIGNMENT_PENDING) {
        if (!offerRepository) {
          throw new Error("cancelShipment requiere offerRepository (ShipmentsServiceOptions) para notificar ofertas pendientes.");
        }

        const offers = await offerRepository.listByShipment(shipmentId);
        const pendingOffers = offers.filter((offer) => offer.status === OfferStatus.PENDING);

        await Promise.all(
          pendingOffers.map(async (offer) => {
            if (!notificationsClient) {
              return;
            }
            try {
              const { title, body } = renderNotificationTrigger("offerVoidedByShipmentCancellation", undefined);
              await notificationsClient.sendPush({
                userId: offer.carrierId,
                title,
                body,
                category: notificationTriggerCategory("offerVoidedByShipmentCancellation"),
                data: { type: "shipment", shipmentId },
              });
            } catch (err) {
              logger?.warn(
                { err, event: "notification_dispatch_failed", shipmentId, carrierId: offer.carrierId },
                "No se pudo notificar al transportista sobre la cancelación del envío"
              );
            }
          })
        );
      }

      return cancelled;
    },

    /**
     * MOVO-130 AC3/AC4: Barrido periódico de envíos no confirmados por el receptor.
     * Transiciona a cancelled en lotes y envía notificación push al emisor (best-effort).
     */
    async expireOverdueShipments(batchSize = 100): Promise<{ expiredCount: number; errorsCount: number }> {
      const now = new Date();
      const overdueShipments = await repository.findExpiredAwaitingConfirmation(now, batchSize);
      let expiredCount = 0;
      let errorsCount = 0;

      for (const shipment of overdueShipments) {
        try {
          await repository.updateStatus(
            shipment.id,
            ShipmentStatus.CANCELLED,
            null,
            "El receptor no confirmó dentro del plazo"
          );
          expiredCount++;

          if (notificationsClient) {
            void dispatchReceiverTimeoutPush(notificationsClient, usersClient, logger, shipment);
          }
        } catch (err) {
          errorsCount++;
          logger?.error(
            { err, shipmentId: shipment.id, event: "receiver_confirmation_sweep_error" },
            "Error al expirar envío no confirmado en barrido"
          );
        }
      }

      if (overdueShipments.length > 0) {
        logger?.info(
          {
            event: "receiver_confirmation_sweep",
            totalFound: overdueShipments.length,
            expiredCount,
            errorsCount,
          },
          `Barrido de confirmación de receptor finalizado: ${expiredCount} expirados, ${errorsCount} fallos`
        );
      }

      return { expiredCount, errorsCount };
    },

    /**
     * Barrido periódico de envíos `published` cuya ventana de retiro venció sin que
     * ningún transportista lo tomara — corrección directa sobre un bug reportado
     * (`GET /shipments/available` los seguía devolviendo como disponibles, sin ticket
     * propio, ver CLAUDE.md). Mismo esqueleto que `expireOverdueShipments` (MOVO-130):
     * lote acotado, cancela con `actorId: null`, notifica al emisor best-effort. La
     * diferencia está en `repository.findPotentiallyExpiredPublished()`, que no puede
     * filtrar "ya venció" en la propia query (ver el comentario de esa interfaz) —
     * acá se filtra con `isPickupWindowExpired()` antes de tocar nada, así que un
     * `published` todavía vigente que entró en el batch (por estar entre los primeros
     * `batchSize` ordenados por fecha de retiro) simplemente se ignora, sin contar
     * como error.
     */
    async expireOverduePublishedShipments(batchSize = 100): Promise<{ expiredCount: number; errorsCount: number }> {
      const now = new Date();
      const candidates = await repository.findPotentiallyExpiredPublished(batchSize);
      const overdueShipments = candidates.filter((shipment) =>
        isPickupWindowExpired(shipment.pickupDate, shipment.pickupTimeWindowEnd, now)
      );
      let expiredCount = 0;
      let errorsCount = 0;

      for (const shipment of overdueShipments) {
        try {
          await repository.updateStatus(
            shipment.id,
            ShipmentStatus.CANCELLED,
            null,
            "Nadie retiró el paquete dentro de la ventana de retiro publicada"
          );
          expiredCount++;

          if (notificationsClient) {
            void dispatchPickupExpiredPush(notificationsClient, logger, shipment);
          }
        } catch (err) {
          errorsCount++;
          logger?.error(
            { err, shipmentId: shipment.id, event: "pickup_expiry_sweep_error" },
            "Error al cancelar envío publicado con retiro vencido en barrido"
          );
        }
      }

      if (overdueShipments.length > 0) {
        logger?.info(
          {
            event: "pickup_expiry_sweep",
            totalFound: overdueShipments.length,
            expiredCount,
            errorsCount,
          },
          `Barrido de retiro vencido finalizado: ${expiredCount} expirados, ${errorsCount} fallos`
        );
      }

      return { expiredCount, errorsCount };
    },

    /**
     * MOVO-170: historial de envíos compartido entre el viewer y otro usuario
     * cualquiera, sin importar el rol de cada uno -- `GET /shipments/history-with/:userId`.
     * Sin autorización adicional más allá de estar autenticado (a diferencia de
     * `getShipmentDetail`): no expone ningún envío puntual, solo un agregado.
     */
    async getSharedHistory(
      viewerId: string,
      otherUserId: string
    ): Promise<{ sharedShipmentCount: number; lastSharedAt: Date | null; allDelivered: boolean }> {
      return repository.getSharedHistory(viewerId, otherUserId);
    },

    /**
     * MOVO-192: envíos activos del caller en un rol (`GET /shipments/sending|
     * transporting|receiving`). El rol sale siempre del endpoint consultado, nunca de
     * un parámetro del caller (AC8) -- por eso esta firma ni siquiera acepta un
     * `userId` de otra persona. Sin autorización adicional más allá de estar
     * autenticado (a diferencia de `getShipmentDetail`): la query de
     * `repository.listActiveShipments` ya está acotada a filas donde `callerId`
     * participa, así que no hay nada que autorizar aparte.
     */
    async listActiveShipments(role: ActiveShipmentRole, callerId: string): Promise<ActiveShipmentResult[]> {
      const shipments = await repository.listActiveShipments(ACTIVE_SHIPMENT_ROLE_TO_COLUMN[role], callerId);
      if (shipments.length === 0) {
        return [];
      }

      // Dedup antes de llamar a usersClient: varios envíos activos del mismo caller
      // pueden compartir la misma contraparte (ej. dos envíos con el mismo
      // transportista) -- un solo findPublicProfile por id único, no uno por ítem.
      const counterpartyIds = new Set(shipments.map((shipment) => resolveActiveShipmentCounterpartyId(role, shipment)));
      const profileById = new Map<string, PublicProfile | null>();
      await Promise.all(
        Array.from(counterpartyIds).map(async (counterpartyId) => {
          try {
            profileById.set(counterpartyId, await usersClient.findPublicProfile(counterpartyId, callerId));
          } catch (err) {
            logger?.warn(
              { err, event: "active_shipment_counterparty_lookup_failed", counterpartyId },
              "No se pudo resolver el perfil de la contraparte de un envío activo"
            );
            profileById.set(counterpartyId, null);
          }
        })
      );

      const now = new Date();
      return shipments.map((shipment) => {
        // Garantizado por `ACTIVE_SHIPMENT_STATUSES` -- `repository.listActiveShipments`
        // ya filtró por ese subconjunto antes de llegar acá.
        const status = shipment.status as ActiveShipmentStatus;
        const counterpartyId = resolveActiveShipmentCounterpartyId(role, shipment);
        const counterpartyProfile = profileById.get(counterpartyId) ?? null;
        return {
          id: shipment.id,
          status,
          pickupDate: shipment.pickupDate,
          pickupTimeWindowStart: shipment.pickupTimeWindowStart,
          pickupTimeWindowEnd: shipment.pickupTimeWindowEnd,
          pickupAddress: shipment.pickupAddress,
          deliveryAddress: shipment.deliveryAddress,
          agreedPriceArs: shipment.agreedPriceArs,
          counterparty: {
            name: counterpartyProfile?.fullName ?? UNKNOWN_COUNTERPARTY_NAME,
            initials: getInitials(counterpartyProfile?.fullName),
          },
          isToday: isShipmentPickupToday(shipment.pickupDate, now),
          pickupWindowExpired: isActiveShipmentPickupWindowExpired(
            status,
            shipment.pickupDate,
            shipment.pickupTimeWindowEnd,
            now
          ),
        };
      });
    },

    /**
     * MOVO-206: Ruta optimizada multi-parada del transportista autenticado (`GET /shipments/my-route`).
     * - Consulta envíos activos del transportista.
     * - Agrega paradas (pickup y delivery para `assigned`, solo delivery para `in_transit`).
     * - Si no hay paradas: devuelve ruta vacía (200, AC4).
     * - Llama a OR-Tools vía `pricingLogisticsClient.optimizeRoute` (AC5).
     * - Si el solver falla: aplica degradación heurística con `optimized: false` (AC6).
     * - On-demand, sin persistencia en BD (AC7, AC9).
     *
     * MOVO-235: `tripId` opcional acota la ruta a las paradas de ESE viaje (en vez de
     * todos los envíos activos del transportista) -- el mapa de MOVO-207 navega acá
     * recién después de "Iniciar viaje", así que se exige `trip.status === active`
     * (409 `TRIP_NOT_ACTIVE`, código que había quedado sin uso desde MOVO-221) en vez
     * del criterio más laxo "declared o active" que usan `getTripMatches`/
     * `createOfferForShipment`. AC5 del ticket (¿reusar la ruta que ya calculó
     * `POST /trips/:id/start`?): no aplica -- el warm-up de `/start` es fire-and-forget
     * y descarta su resultado (no hay dónde persistirlo en `Trip`, mismo criterio
     * "on-demand sin persistencia" de MOVO-206 AC7/AC9), así que no hay ningún cache
     * real del que esta ruta pueda leer.
     * Autorización vía `assertTripAccess` (`../trips/trip-access.ts`, admin incluido
     * por default -- fix de review: la primera versión no aceptaba `callerRoles` y
     * bloqueaba con 403 incluso a un administrador).
     */
    async getMyRoute(
      carrierId: string,
      location: { lat: number; lng: number },
      tripId?: string,
      callerRoles: UserRole[] = [],
    ): Promise<CarrierRoute> {
      if (tripId) {
        if (!tripRepository) {
          throw new Error("getMyRoute requiere tripRepository (ShipmentsServiceOptions) para validar tripId.");
        }
        const trip = await tripRepository.findById(tripId);
        if (!trip) {
          throw new ApiError(404, "TRIP_NOT_FOUND", `El viaje '${tripId}' no existe.`);
        }
        assertTripAccess(trip, carrierId, callerRoles, {
          forbiddenMessage: "No tenés permiso para ver la ruta de este viaje.",
        });
        if (trip.status !== TripStatus.ACTIVE) {
          // Fix de review: el mensaje anterior siempre decía "iniciá el viaje", pero
          // este 409 también dispara para CANCELLED/COMPLETED -- confuso para un viaje
          // que ya terminó y no va a "iniciarse" nunca.
          const message =
            trip.status === TripStatus.DECLARED
              ? `El viaje '${tripId}' todavía no está iniciado (estado actual: '${trip.status}'). Iniciá el viaje antes de pedir su ruta.`
              : `El viaje '${tripId}' ya no está en curso (estado actual: '${trip.status}').`;
          throw new ApiError(409, "TRIP_NOT_ACTIVE", message);
        }
      }

      // 1. Envíos activos del transportista (aprovecha query de MOVO-192), acotados al
      // viaje si vino tripId (MOVO-235 AC1)
      const shipments = await repository.listActiveShipments("carrierId", carrierId, tripId);

      // 2. Composición de paradas (AC2)
      const stops = aggregateCarrierStops(shipments);

      // 3. Si no hay paradas activas, ruta vacía (AC4)
      if (stops.length === 0) {
        return buildEmptyRoute();
      }

      // 4. Invocación a pricing-logistics con fallback de degradación heurística (AC6)
      if (!pricingLogisticsClient) {
        logger?.warn(
          { event: "my_route_solver_missing", carrierId },
          "pricingLogisticsClient no inyectado -- retornando ruta degradada"
        );
        return buildDegradedRoute(stops);
      }

      try {
        const result = await pricingLogisticsClient.optimizeRoute({
          carrierLocation: { lat: location.lat, lng: location.lng },
          stops,
        });
        return mapOptimizedRoute(result);
      } catch (err) {
        logger?.warn(
          { err, event: "my_route_solver_failed", carrierId },
          "Fallo al invocar el optimizador de rutas -- aplicando degradación heurística (AC6)"
        );
        return buildDegradedRoute(stops);
      }
    },

    /**
     * MOVO-222: envíos `delivered`/`completed` de `callerId` (en cualquier rol --
     * emisor, receptor o transportista) donde todavía le falta calificar a alguna
     * contraparte dentro de la ventana de 72hs. Solo se devuelven ítems con algo
     * pendiente (AC del ticket: `pendingRatingFor` nunca viaja vacío acá).
     */
    async listPendingRatings(callerId: string): Promise<PendingRatingResult[]> {
      if (!ratingRepository) {
        return [];
      }

      // MOVO-222 (corregido en review): el prefiltro SQL suma `MAX_DISPUTE_FREEZE_HOURS`
      // de margen sobre `RATING_WINDOW_HOURS` -- antes cortaba a secas en las 72hs y
      // podía descartar en la propia query un candidato cuya ventana real (extendida
      // por un freeze de disputa) `isRatingWindowOpen` todavía consideraría abierta.
      const deliveredSince = new Date(
        Date.now() - (RATING_WINDOW_HOURS + MAX_DISPUTE_FREEZE_HOURS) * 60 * 60 * 1000
      );
      const candidates = await repository.findPendingRatingCandidates(callerId, deliveredSince);
      if (candidates.length === 0) {
        return [];
      }

      const [myRatings, eventsByShipment] = await Promise.all([
        ratingRepository.listByRaterForShipments(
          callerId,
          candidates.map((shipment) => shipment.id)
        ),
        // MOVO-222 (corregido en review): en paralelo -- antes se traía en un `for`
        // secuencial, un round-trip a la DB por candidato, mismo N+1 que este método ya
        // evita explícitamente para `listByRaterForShipments`.
        Promise.all(candidates.map((shipment) => repository.listEvents(shipment.id))),
      ]);
      const ratedRolesByShipment = new Map<string, Set<RatingRole>>();
      for (const rating of myRatings) {
        const roles = ratedRolesByShipment.get(rating.shipmentId) ?? new Set<RatingRole>();
        roles.add(rating.role);
        ratedRolesByShipment.set(rating.shipmentId, roles);
      }

      const results: PendingRatingResult[] = [];
      candidates.forEach((shipment, index) => {
        // `carrierId` es nullable en el schema, pero `delivered`/`completed` solo se
        // alcanza después de `in_transit`, que ya requiere `carrierId` asignado --
        // guarda explícita en vez de un cast ciego: si esta invariante del state
        // machine se rompiera alguna vez, se descarta el ítem (con warning) en vez de
        // tirar un 500 de serialización para el resto de la lista.
        if (!shipment.carrierId) {
          logger?.warn(
            { shipmentId: shipment.id, status: shipment.status },
            "listPendingRatings: envío fulfilled sin carrierId, se omite"
          );
          return;
        }

        const events = eventsByShipment[index] ?? [];
        const alreadyRated = ratedRolesByShipment.get(shipment.id) ?? new Set<RatingRole>();
        const pendingRatingFor = computePendingRatingFor(shipment, events, callerId, alreadyRated);
        if (pendingRatingFor.length === 0) {
          return;
        }
        results.push({
          id: shipment.id,
          // Garantizado por `FULFILLED_SHIPMENT_STATUSES` -- `findPendingRatingCandidates`
          // ya filtró por ese subconjunto antes de llegar acá.
          status: shipment.status as ShipmentStatus.DELIVERED | ShipmentStatus.COMPLETED,
          // Garantizado por `computePendingRatingFor` (nunca deja pasar sin `deliveredAt`).
          deliveredAt: shipment.deliveredAt as Date,
          ratingDeadline: computeRatingWindowDeadline(shipment.deliveredAt as Date, events),
          senderId: shipment.senderId,
          receiverId: shipment.receiverId,
          carrierId: shipment.carrierId,
          pendingRatingFor,
        });
      });
      return results;
    },
  };
}
