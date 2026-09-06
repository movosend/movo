import { ApiError, OfferStatus, ShipmentStatus, TripStatus, UserRole, computeOfferGrossPrice } from "@movo/shared";
import { FastifyBaseLogger } from "fastify";
import { ShipmentRepository } from "../../repositories/shipment-repository";
import { OfferRepository } from "../../repositories/offer-repository";
import { TripRepository } from "../../repositories/trip-repository";
import { UsersClient } from "../../adapters/users-client";
import { NotificationsClient } from "../../adapters/notifications-client";
import { PricingClient } from "../../adapters/pricing-client";
import { AvailableShipment, PackageType, Shipment, ShipmentEvent } from "../../models/shipment";
import { isPickupWindowExpired } from "../../domain/pickup-window";
import { haversineKm } from "../../domain/geo";
import { Offer } from "../../models/offer";
import {
  assertIsNotShipmentParty,
  assertIsReceiver,
  assertIsSenderOrAdmin,
  assertShipmentAccess,
} from "./assert-shipment-access";

type ShipmentsServiceLogger =
  | FastifyBaseLogger
  | { info?: (obj: unknown, msg?: string) => void; warn: (obj: unknown, msg?: string) => void; error?: (obj: unknown, msg?: string) => void };

interface NewOfferPushParams {
  senderId: string;
  carrierName: string | null;
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
    await notificationsClient.sendPush({
      userId: params.senderId,
      title: "Nueva oferta en tu envío",
      body: params.carrierName ? `${params.carrierName} ofertó por tu envío.` : "Recibiste una nueva oferta.",
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
  /** "YYYY-MM-DD", tiene que coincidir con `shipment.pickupDate` (AC5). */
  offeredDate: string;
  message?: string;
  /** MOVO-162: viaje declarado (activo, del propio `carrierId`) del que esta oferta
   * forma parte -- opcional, la mayoría de las ofertas no vienen de un viaje
   * declarado (MOVO-142, descubrimiento libre). */
  tripId?: string;
}

export interface CreateOfferForShipmentResult extends Offer {
  priceNetArs: number;
  commissionAmountArs: number;
}

export interface ListAvailableResult {
  items: Array<AvailableShipment & { hasMyOffer: boolean }>;
  page: number;
  limit: number;
  total: number;
}

// MOVO-126: retiro y entrega a menos de 100m se tratan como la misma ubicación —
// umbral chico a propósito (mismo criterio que el rechazo duro de
// SHIPMENT_RECEIVER_IS_SENDER, un caso que nunca tiene sentido de negocio), no
// pensado para descartar casos legítimos como "de mi depto a la portería del mismo
// edificio".
const MIN_PICKUP_DELIVERY_DISTANCE_KM = 0.1;

/** "HH:MM" -> "HH:MM:00"; "HH:MM:SS" queda igual. */
function normalizeTime(time: string): string {
  return time.length === 5 ? `${time}:00` : time;
}

/** Fecha+hora real (para comparar contra "ahora" y validar la franja). */
function combineDateAndTime(dateStr: string, timeStr: string): Date {
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
  title: string;
  bodyTemplate: (name: string) => string;
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
    await notificationsClient.sendPush({
      userId: params.shipment.senderId,
      title: params.title,
      body: params.bodyTemplate(receiverName),
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
    await notificationsClient.sendPush({
      userId: shipment.senderId,
      title: "Envío cancelado",
      body: `Tu envío se canceló: ${receiverName} no lo confirmó a tiempo`,
      data: { shipmentId: shipment.id, type: "shipment_cancelled" },
    });
  } catch (err) {
    logger?.warn(
      { err, event: "notification_dispatch_failed", shipmentId: shipment.id },
      "No se pudo enviar la push de cancelación por timeout al emisor"
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
    await notificationsClient.sendPush({
      userId: shipment.senderId,
      title: "Envío cancelado",
      body: "Tu envío se canceló: ningún transportista lo retiró dentro de la ventana publicada",
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
  /** Requerido solo para `createOfferForShipment` cuando el caller manda `tripId`
   * (MOVO-162) -- valida que el viaje exista, sea del mismo transportista y siga
   * `active` antes de dejar que la oferta lo referencie. */
  tripRepository?: TripRepository;
}

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
  const getCarrierReputationScore = opts.getCarrierReputationScore;
  const tripRepository = opts.tripRepository;

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
        pickupDate: new Date(`${input.pickupDate}T00:00:00.000Z`),
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
          await notificationsClient.sendPush({
            userId: created.receiverId,
            title: "Tenés un envío nuevo para confirmar",
            body: `${senderName} te envió un paquete. Tocá para revisar y confirmar el envío.`,
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
    async getShipmentDetail(shipmentId: string, callerId: string, callerRoles: UserRole[]): Promise<Shipment> {
      const shipment = await repository.findById(shipmentId);
      if (!shipment) {
        throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");
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
        return shipment;
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

      // MOVO-162: tripId opcional -- valida que el viaje exista, sea del mismo
      // transportista y siga activo antes de dejar que la oferta lo referencie. Sin
      // este chequeo, cualquier caller podría taggear la oferta con el viaje de otro
      // transportista o uno ya cancelado, y Trip.hasAcceptedPackages
      // (trip-repository.ts) perdería sentido. Deliberadamente NO valida que el envío
      // caiga geométricamente dentro del corredor del viaje -- todavía no hay ningún
      // consumidor real que dispare este campo (MOVO-163/MOVO-149 no lo contemplan en
      // su AC), así que esa validación queda para cuando exista ese flujo y se sepa
      // qué radio/semántica espera.
      if (input.tripId) {
        if (!tripRepository) {
          throw new Error("createOfferForShipment requiere tripRepository (ShipmentsServiceOptions) para validar tripId.");
        }
        const trip = await tripRepository.findById(input.tripId);
        if (!trip) {
          throw new ApiError(404, "TRIP_NOT_FOUND", `El viaje '${input.tripId}' no existe.`);
        }
        if (trip.carrierId !== input.carrierId) {
          throw new ApiError(403, "AUTH_FORBIDDEN", "No podés ofertar en nombre de un viaje que no es tuyo.");
        }
        if (trip.status !== TripStatus.ACTIVE) {
          throw new ApiError(409, "TRIP_NOT_ACTIVE", "Solo podés ofertar desde un viaje activo.");
        }
      }

      // AC6: el transportista ingresa el NETO, el servidor calcula el BRUTO -- nunca
      // al revés. `computeOfferGrossPrice` es una función pura de `@movo/shared`
      // (misma tasa que usará el split real de movo-svc-payments más adelante, ver
      // shared/movo-shared/src/config/commission.ts).
      const { netArs, commissionAmountArs, grossArs } = computeOfferGrossPrice(input.priceNetArs);

      // AC7: snapshot del transportista. El nombre sigue el mismo criterio
      // cross-servicio que ya usa `createShipment` para el receptor
      // (`usersClient.findPublicProfile`); el rating sigue el criterio documentado en
      // MOVO-147 -- llamada LOCAL (misma DB/proceso) vía `getCarrierReputationScore`,
      // sin HTTP contra sí mismo. Puede resolver `null` (agregado sin calificaciones
      // todavía) -- no bloquea la creación de la oferta.
      const [carrierProfile, carrierRatingAtOffer] = await Promise.all([
        usersClient.findPublicProfile(input.carrierId, input.carrierId),
        getCarrierReputationScore ? getCarrierReputationScore(input.carrierId) : Promise.resolve(null),
      ]);

      const offer = await offerRepository.create({
        shipmentId: input.shipmentId,
        carrierId: input.carrierId,
        priceOffered: grossArs,
        offeredDate: new Date(`${input.offeredDate}T00:00:00.000Z`),
        message: input.message,
        tripId: input.tripId ?? null,
        carrierNameAtOffer: carrierProfile?.fullName ?? null,
        carrierRatingAtOffer,
      });

      // AC9: best-effort, fire-and-forget -- un fallo de la notificación no revierte
      // la creación de la oferta (que ya commiteó arriba).
      void dispatchNewOfferPush(notificationsClient, logger, {
        senderId: shipment.senderId,
        carrierName: offer.carrierNameAtOffer,
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
          title: "Envío aceptado",
          bodyTemplate: (name) => `${name} aceptó el envío, ya está publicado`,
          type: "shipment_accepted",
        });
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
          title: "Envío rechazado",
          bodyTemplate: (name) => `${name} rechazó el envío`,
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
              await notificationsClient.sendPush({
                userId: offer.carrierId,
                title: "Tu oferta fue cancelada",
                body: "El envío ya no está disponible.",
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
  };
}
