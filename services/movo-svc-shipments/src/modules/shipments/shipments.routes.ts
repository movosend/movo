import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from "fastify";
import { createShipmentsService, CreateShipmentServiceInput } from "./shipments.service";
import { createPhotosService, ConfirmPhotoInput, PresignPhotoInput } from "./photos.service";
import { shipmentsSchemas } from "./shipments.schema";
import { requireUserIdFromHeader } from "../../utils/require-user-id";
import { getUserRolesFromHeader } from "../../utils/get-user-roles";
import { createUsersClient, UsersClient } from "../../adapters/users-client";
import { createStorageProvider, StorageProvider } from "../../adapters/storage-provider";
import { createRoutesProvider, RoutesProvider } from "../../adapters/routes-provider";
import { createNotificationsClient, NotificationsClient } from "../../adapters/notifications-client";
import { createPricingClient, PricingClient } from "../../adapters/pricing-client";
import { createShipmentRepository } from "../../repositories/shipment-repository";
import { createOfferRepository } from "../../repositories/offer-repository";
import { createTripRepository, TripRepository } from "../../repositories/trip-repository";
import { createRatingRepository } from "../../repositories/rating-repository";
import { createRatingsService } from "../ratings/ratings.service";
import { AvailableShipment, Shipment, ShipmentEvent } from "../../models/shipment";
import { CreateOfferForShipmentResult, ListShipmentOffersQuery, ListShipmentOffersSort } from "./shipments.service";
import { toOfferDto } from "../offers/offer.dto";

export interface ShipmentsRoutesOptions extends FastifyPluginOptions {
  /** Override solo para tests de integración — evita depender de un `movo-svc-users`
   * real levantado, mismo criterio que `storageProvider`/`diditClient` en
   * movo-svc-users. */
  usersClient?: UsersClient;
  /** Override solo para tests de integración — evita depender de un bucket real/
   * credenciales de AWS (MOVO-81), mismo criterio que `storageProvider` en
   * movo-svc-users. */
  storageProvider?: StorageProvider;
  /** Override solo para tests de integración — evita depender de credenciales reales
   * de Google (MOVO-123), mismo criterio que `usersClient`. */
  routesProvider?: RoutesProvider;
  /** Override solo para tests de integración — evita depender de un `movo-svc-users`
   * real levantado (MOVO-108/129), mismo criterio que `usersClient`. */
  notificationsClient?: NotificationsClient;
  /** Override solo para tests de integración — evita depender de un
   * `movo-svc-pricing-logistics` real levantado (MOVO-82), mismo criterio que
   * `usersClient`. */
  pricingClient?: PricingClient;
  /** Override solo para tests de integración — mismo criterio que `usersClient`. */
  tripRepository?: TripRepository;
}

type CreateShipmentBody = Omit<CreateShipmentServiceInput, "senderId">;

/**
 * `pickupDate`/`pickupTimeWindowStart`/`pickupTimeWindowEnd` se guardan como `Date`
 * ancladas a UTC (medianoche UTC / fecha epoch 1970 + hora UTC) -- valores de
 * calendario/reloj de pared, no instantes reales. Los serializadores `asDate`/`asTime`
 * de fast-json-stringify (detrás de `format: "date"`/`"time"`) le restan el
 * `getTimezoneOffset()` del proceso antes de recortar el ISO string: pensado para un
 * instante real que se quiere mostrar en hora local, así que sobre un valor ya
 * anclado a UTC corre el campo (verificado en local, TZ -03:00 de Córdoba: "09:00"
 * salía como "06:00"). Se convierten acá a string ya formateado -- `asDate`/`asTime`
 * dejan pasar un string tal cual, sin tocarlo.
 */
function toShipmentDto(shipment: Shipment) {
  return {
    ...shipment,
    pickupDate: shipment.pickupDate.toISOString().slice(0, 10),
    pickupTimeWindowStart: shipment.pickupTimeWindowStart.toISOString().slice(11, 19),
    pickupTimeWindowEnd: shipment.pickupTimeWindowEnd.toISOString().slice(11, 19),
    receiverConfirmationDeadline: shipment.receiverConfirmationDeadline
      ? shipment.receiverConfirmationDeadline.toISOString()
      : null,
  };
}

/** Mismo fix de formato UTC que toShipmentDto (ver su comentario) -- no se reusa esa
 * función porque su input es Shipment completo, no AvailableShipment (MOVO-142,
 * AC9: sin senderId/receiverId). No se extrae a un archivo shipments.dto.ts propio a
 * diferencia de toOfferDto (MOVO-144, compartida entre dos route files): esta función
 * solo la usa esta ruta. */
function toAvailableShipmentDto(item: AvailableShipment & { hasMyOffer: boolean }) {
  return {
    ...item,
    pickupDate: item.pickupDate.toISOString().slice(0, 10),
    pickupTimeWindowStart: item.pickupTimeWindowStart.toISOString().slice(11, 19),
    pickupTimeWindowEnd: item.pickupTimeWindowEnd.toISOString().slice(11, 19),
  };
}

function toShipmentEventDto(event: ShipmentEvent) {
  return {
    id: event.id,
    shipmentId: event.shipmentId,
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    actorId: event.actorId,
    reason: event.reason,
    createdAt: event.createdAt,
  };
}

export default async function shipmentsRoutes(app: FastifyInstance, opts: ShipmentsRoutesOptions) {
  const usersClient = opts.usersClient ?? createUsersClient(app.config);
  const storageProvider = opts.storageProvider ?? createStorageProvider(app.config);
  const routesProvider = opts.routesProvider ?? createRoutesProvider(app.config);
  const notificationsClient = opts.notificationsClient ?? createNotificationsClient(app.config);
  const pricingClient = opts.pricingClient ?? createPricingClient(app.config);
  const repository = createShipmentRepository(app.db);
  const offerRepository = createOfferRepository(app.db);
  const tripRepository = opts.tripRepository ?? createTripRepository(app.db);
  // MOVO-143 AC7: mismo criterio documentado en MOVO-147 -- getReputationSummary() se
  // llama LOCAL (misma DB/proceso, sin HTTP contra sí mismo) para snapshotear
  // carrierRatingAtOffer. Se construye acá un ratingsService propio (en vez de
  // reusar uno inyectado) porque este módulo no tiene otro motivo para depender de
  // `ratings.routes.ts`.
  const ratingsService = createRatingsService(repository, createRatingRepository(app.db), undefined, app.log, {
    confidenceConstant: app.config.REPUTATION_CONFIDENCE_CONSTANT,
    decayHalfLifeDays: app.config.REPUTATION_DECAY_HALF_LIFE_DAYS,
  });
  const service = createShipmentsService(repository, usersClient, notificationsClient, app.log, {
    receiverConfirmationTimeoutHours: app.config.RECEIVER_CONFIRMATION_TIMEOUT_HOURS,
    offerRepository,
    pricingClient,
    tripRepository,
    getCarrierReputationScore: async (carrierId: string) => {
      const summary = await ratingsService.getReputationSummary(carrierId);
      return summary.asCarrier.reputationScore;
    },
  });
  const photosService = createPhotosService(repository, storageProvider, app.redis, app.log);

  app.post(
    "/",
    {
      schema: {
        summary: "Crear un envío",
        description:
          "AC1/AC2 de MOVO-80: crea el envío en estado awaiting_receiver_confirmation. " +
          "El senderId sale SIEMPRE del header x-user-id inyectado por el gateway (AC10) " +
          "— cualquier senderId en el body es rechazado por el schema (additionalProperties: " +
          "false), nunca leído. Falla con 404/422 si el receptor no existe, tiene KYC de " +
          "identidad sin aprobar, es el propio emisor, o la franja de retiro es inválida.",
        tags: ["shipments"],
        body: shipmentsSchemas.createShipmentBody,
        response: {
          201: shipmentsSchemas.shipmentResponse,
          400: shipmentsSchemas.errorResponse,
          401: shipmentsSchemas.errorResponse,
          404: shipmentsSchemas.errorResponse,
          422: shipmentsSchemas.errorResponse,
          502: shipmentsSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const senderId = requireUserIdFromHeader(request);
      const body = request.body as CreateShipmentBody;
      const shipment = await service.createShipment({ ...body, senderId });
      reply.code(201);
      return toShipmentDto(shipment);
    }
  );

  // Ruta estática — se registra antes de "/:id" por claridad para el próximo que lea
  // el archivo, aunque el radix router de Fastify (find-my-way) ya prioriza segmentos
  // estáticos sobre paramétricos sin importar el orden de registro.
  app.get(
    "/mine",
    {
      schema: {
        summary: "Mis envíos",
        description:
          "AC9 de MOVO-80: lista paginada de los envíos donde el usuario autenticado " +
          "participa como emisor o como receptor, más reciente primero.",
        tags: ["shipments"],
        querystring: shipmentsSchemas.listMineQuery,
        response: {
          200: shipmentsSchemas.listMineResponse,
          401: shipmentsSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      const userId = requireUserIdFromHeader(request);
      const { page, limit } = request.query as { page: number; limit: number };
      const result = await service.listMyShipments(userId, page, limit);
      return { ...result, items: result.items.map(toShipmentDto) };
    }
  );

  // Ruta estática — mismo criterio que "/mine": se registra antes de "/:id" por
  // claridad, aunque find-my-way ya prioriza segmentos estáticos.
  app.get(
    "/route",
    {
      schema: {
        summary: "Ruta origen→destino para el mapa",
        description:
          "MOVO-123: polyline codificado (algoritmo estándar de Google) de la ruta " +
          "real por calle entre dos puntos — consumido por el mapa del paso de resumen " +
          "del wizard de envíos (MOVO-83). Requiere autenticación (igual que el resto de " +
          "`/shipments`) pero no depende del `x-user-id`, cualquier usuario logueado " +
          "puede pedir cualquier ruta.",
        tags: ["shipments"],
        querystring: shipmentsSchemas.routeQuery,
        response: {
          200: shipmentsSchemas.routeResponse,
          400: shipmentsSchemas.errorResponse,
          401: shipmentsSchemas.errorResponse,
          422: shipmentsSchemas.errorResponse,
          502: shipmentsSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      requireUserIdFromHeader(request);
      const { originLat, originLng, destinationLat, destinationLng } = request.query as {
        originLat: number;
        originLng: number;
        destinationLat: number;
        destinationLng: number;
      };
      return routesProvider.getRoute({
        origin: { lat: originLat, lng: originLng },
        destination: { lat: destinationLat, lng: destinationLng },
      });
    }
  );

  // Ruta estática — mismo criterio que "/mine"/"/route": se registra antes de "/:id"
  // por claridad, aunque find-my-way ya prioriza segmentos estáticos.
  app.get(
    "/available",
    {
      schema: {
        summary: "Envíos disponibles cerca mío (descubrimiento del transportista)",
        description:
          "MOVO-142: originLat/Lng (obligatorio) es de dónde parte el transportista -- " +
          "sin más, devuelve envíos published con el retiro dentro de radiusKm de ahí. " +
          "destinationLat/Lng es OPCIONAL (los dos juntos, o ninguno): si el " +
          "transportista tiene un viaje planificado, filtra por CORREDOR -- retiro y " +
          "entrega dentro de radiusKm del segmento origen→destino (no de cada punto " +
          "por separado, para no dejar afuera un envío en el medio del trayecto) -- y " +
          "el orden pasa a ser la suma de ambas distancias al corredor. Sin destino, " +
          "se ordena solo por la distancia al retiro. urgent viaja en la respuesta " +
          "pero no altera el orden. " +
          "maxDistanceKm (opcional, sin default) tapea la distancia PROPIA " +
          "retiro→entrega del envío, sin relación con el trayecto del caller. " +
          "Excluye los envíos propios del caller (sender o receiver). Requiere rol " +
          "carrier + KYC de identidad aprobado (403 CARRIER_NOT_VERIFIED -- nunca " +
          "licencia de conducir, que es insignia de confianza, no permiso de acceso). " +
          "hasMyOffer marca los envíos donde el caller ya tiene una oferta pending.",
        tags: ["shipments"],
        querystring: shipmentsSchemas.listAvailableQuery,
        response: {
          200: shipmentsSchemas.listAvailableResponse,
          400: shipmentsSchemas.errorResponse,
          401: shipmentsSchemas.errorResponse,
          403: shipmentsSchemas.errorResponse,
          502: shipmentsSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      const callerId = requireUserIdFromHeader(request);
      const callerRoles = getUserRolesFromHeader(request);
      const { originLat, originLng, destinationLat, destinationLng, radiusKm, maxDistanceKm, page, limit } =
        request.query as {
          originLat: number;
          originLng: number;
          destinationLat?: number;
          destinationLng?: number;
          radiusKm: number;
          maxDistanceKm?: number;
          page: number;
          limit: number;
        };
      const result = await service.listAvailableShipments(callerId, callerRoles, {
        originLat,
        originLng,
        destinationLat,
        destinationLng,
        radiusKm,
        maxDistanceKm,
        page,
        limit,
      });
      return { ...result, items: result.items.map(toAvailableShipmentDto) };
    }
  );

  // Ruta estática de dos segmentos ("/history-with/:userId") — no colisiona con
  // "/:id" (un solo segmento), pero se registra antes por el mismo criterio de
  // prolijidad que "/mine"/"/route"/"/available".
  app.get(
    "/history-with/:userId",
    {
      schema: {
        summary: "Historial de envíos compartido con otro usuario",
        description:
          "MOVO-170: cuántos envíos tuvo el caller en común con userId, sin importar " +
          "el rol de cada uno (emisor/receptor/transportista) en cada envío -- " +
          "consumido por el rediseño de perfil del mobile (MOVO-176) para mostrar " +
          "'ya viajaron/enviaron juntos N veces'. lastSharedAt es null únicamente sin " +
          "ningún envío en común; allDelivered es false también en ese caso.",
        tags: ["shipments"],
        params: shipmentsSchemas.historyWithUserIdParam,
        response: {
          200: shipmentsSchemas.sharedHistoryResponse,
          401: shipmentsSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      const viewerId = requireUserIdFromHeader(request);
      const { userId } = request.params as { userId: string };
      const result = await service.getSharedHistory(viewerId, userId);
      return { ...result, lastSharedAt: result.lastSharedAt ? result.lastSharedAt.toISOString() : null };
    }
  );

  app.get(
    "/:id",
    {
      schema: {
        summary: "Detalle de un envío",
        description:
          "AC8 de MOVO-80: accesible para el emisor, el receptor, un admin, o (MOVO-142) " +
          "el carrier ya asignado (cualquier estado) o un transportista verificado " +
          "cuando el envío está published (apertura de descubrimiento). Un usuario " +
          "ajeno recibe 403, nunca 404 con datos filtrados.",
        tags: ["shipments"],
        params: shipmentsSchemas.shipmentIdParam,
        response: {
          200: shipmentsSchemas.shipmentResponse,
          400: shipmentsSchemas.errorResponse,
          401: shipmentsSchemas.errorResponse,
          403: shipmentsSchemas.errorResponse,
          404: shipmentsSchemas.errorResponse,
          502: shipmentsSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      const callerId = requireUserIdFromHeader(request);
      const callerRoles = getUserRolesFromHeader(request);
      const { id } = request.params as { id: string };
      const shipment = await service.getShipmentDetail(id, callerId, callerRoles);
      return toShipmentDto(shipment);
    }
  );

  app.post(
    "/:id/photos/presign",
    {
      schema: {
        summary: "Presigned URL para subir una foto del paquete",
        description:
          "AC1/AC2/AC3 de MOVO-81: devuelve una presigned URL de PUT a S3 (TTL 5 " +
          "minutos) para el tipo/tamaño declarados -- ambos quedan firmados dentro de " +
          "la URL, no solo validados acá. Solo el emisor puede pedirla, y solo para la " +
          "etapa creation. El s3Key lo genera el servidor bajo shipments/{id}/{stage}/, " +
          "nunca uno propuesto por el cliente.",
        tags: ["shipments"],
        params: shipmentsSchemas.shipmentIdParam,
        body: shipmentsSchemas.presignPhotoBody,
        response: {
          200: shipmentsSchemas.presignPhotoResponse,
          400: shipmentsSchemas.errorResponse,
          401: shipmentsSchemas.errorResponse,
          403: shipmentsSchemas.errorResponse,
          404: shipmentsSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      const callerId = requireUserIdFromHeader(request);
      const { id } = request.params as { id: string };
      const body = request.body as PresignPhotoInput;
      return photosService.getPhotoUploadUrl(id, callerId, body);
    }
  );

  app.post(
    "/:id/photos/confirm",
    {
      schema: {
        summary: "Confirmar foto del paquete subida",
        description:
          "AC4/AC5 de MOVO-81: verifica contra S3 (HEAD) que el objeto exista antes de " +
          "registrarlo en shipment_photos -- sin esto, el cliente podría confirmar " +
          "fotos que nunca subió.",
        tags: ["shipments"],
        params: shipmentsSchemas.shipmentIdParam,
        body: shipmentsSchemas.confirmPhotoBody,
        response: {
          200: shipmentsSchemas.confirmPhotoResponse,
          401: shipmentsSchemas.errorResponse,
          403: shipmentsSchemas.errorResponse,
          404: shipmentsSchemas.errorResponse,
          422: shipmentsSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      const callerId = requireUserIdFromHeader(request);
      const { id } = request.params as { id: string };
      const body = request.body as ConfirmPhotoInput;
      return photosService.confirmPhoto(id, callerId, body);
    }
  );

  app.get(
    "/:id/photos",
    {
      schema: {
        summary: "Fotos del paquete",
        description:
          "AC7/AC8 de MOVO-81: URLs prefirmadas de lectura, TTL corto -- el bucket es " +
          "privado para este prefijo, ningún objeto es accesible públicamente. " +
          "Accesible solo para emisor, receptor o admin.",
        tags: ["shipments"],
        params: shipmentsSchemas.shipmentIdParam,
        response: {
          200: shipmentsSchemas.listPhotosResponse,
          401: shipmentsSchemas.errorResponse,
          403: shipmentsSchemas.errorResponse,
          404: shipmentsSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      const callerId = requireUserIdFromHeader(request);
      const callerRoles = getUserRolesFromHeader(request);
      const { id } = request.params as { id: string };
      return photosService.listPhotoUrls(id, callerId, callerRoles);
    }
  );

  app.get(
    "/:id/events",
    {
      schema: {
        summary: "Historial de eventos de un envío",
        description:
          "MOVO-128: devuelve el historial completo de cambios de estado del envío en " +
          "orden cronológico ascendente. Accesible únicamente para el emisor, el receptor o un admin. " +
          "Un usuario ajeno recibe 403, nunca 404 con datos filtrados.",
        tags: ["shipments"],
        params: shipmentsSchemas.shipmentIdParam,
        response: {
          200: shipmentsSchemas.shipmentEventsResponse,
          400: shipmentsSchemas.errorResponse,
          401: shipmentsSchemas.errorResponse,
          403: shipmentsSchemas.errorResponse,
          404: shipmentsSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      const callerId = requireUserIdFromHeader(request);
      const callerRoles = getUserRolesFromHeader(request);
      const { id } = request.params as { id: string };
      const events = await service.getShipmentEvents(id, callerId, callerRoles);
      return events.map(toShipmentEventDto);
    }
  );

  app.get(
    "/:id/offers",
    {
      schema: {
        summary: "Ofertas de un envío",
        description:
          "AC1-AC5 de MOVO-144: lista las ofertas de un envío para que el emisor elija " +
          "un transportista. Solo el emisor o un admin -- el receptor y los transportistas " +
          "reciben 403. Por defecto solo devuelve ofertas vigentes (pending no vencidas); " +
          "?includeResolved=true suma el historial de ofertas terminales. Orden por precio " +
          "ascendente por defecto (?sort=price|rating|createdAt).",
        tags: ["shipments", "offers"],
        params: shipmentsSchemas.shipmentIdParam,
        querystring: shipmentsSchemas.listShipmentOffersQuery,
        response: {
          200: shipmentsSchemas.listShipmentOffersResponse,
          400: shipmentsSchemas.errorResponse,
          401: shipmentsSchemas.errorResponse,
          403: shipmentsSchemas.errorResponse,
          404: shipmentsSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      const callerId = requireUserIdFromHeader(request);
      const callerRoles = getUserRolesFromHeader(request);
      const { id } = request.params as { id: string };
      const { sort, includeResolved } = request.query as {
        sort?: ListShipmentOffersSort;
        includeResolved?: boolean;
      };
      const query: ListShipmentOffersQuery = { sort, includeResolved };
      const offers = await service.listShipmentOffers(id, callerId, callerRoles, query);
      return offers.map(toOfferDto);
    }
  );

  app.post(
    "/:id/offers",
    {
      schema: {
        summary: "Ofertar sobre un envío",
        description:
          "AC1-AC7/AC9 de MOVO-143: el transportista oferta un precio sobre un envío " +
          "published. Requiere rol carrier + KYC de identidad aprobado (403 " +
          "CARRIER_NOT_VERIFIED), sin exigir licencia de conducir (AC2, insignia de " +
          "confianza, no permiso de acceso). Ni el emisor ni el receptor pueden ofertar " +
          "sobre su propio envío (403 AUTH_FORBIDDEN, AC3). `priceOfferedArs` es el " +
          "NETO que quiere cobrar el transportista -- el servidor calcula el bruto con " +
          "la comisión de Movo (AC6, @movo/shared#computeOfferGrossPrice) y devuelve el " +
          "desglose neto/comisión/bruto. 409 si el envío no está published o si ya " +
          "existe una oferta activa del mismo transportista (AC4); 422 si offeredDate " +
          "no coincide con la fecha de retiro del envío (AC5).",
        tags: ["shipments", "offers"],
        params: shipmentsSchemas.shipmentIdParam,
        body: shipmentsSchemas.createOfferBody,
        response: {
          201: shipmentsSchemas.createOfferResponse,
          400: shipmentsSchemas.errorResponse,
          401: shipmentsSchemas.errorResponse,
          403: shipmentsSchemas.errorResponse,
          404: shipmentsSchemas.errorResponse,
          409: shipmentsSchemas.errorResponse,
          422: shipmentsSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const carrierId = requireUserIdFromHeader(request);
      const callerRoles = getUserRolesFromHeader(request);
      const { id } = request.params as { id: string };
      const { priceOfferedArs, offeredDate, message, tripId } = request.body as {
        priceOfferedArs: number;
        offeredDate: string;
        message?: string;
        tripId?: string;
      };
      const offer: CreateOfferForShipmentResult = await service.createOfferForShipment({
        shipmentId: id,
        carrierId,
        callerRoles,
        priceNetArs: priceOfferedArs,
        offeredDate,
        message,
        tripId,
      });
      reply.code(201);
      return toOfferDto(offer);
    }
  );

  app.post(
    "/:id/cancel",
    {
      // El body es enteramente opcional (`reason` es el único campo, y ni siquiera
      // ese es obligatorio) -- un cliente que no manda ningún payload llega acá con
      // `request.body === undefined`, que el schema de abajo (`type: "object"`)
      // rechazaría con 400 antes de llegar al handler. Default explícito a `{}` antes
      // de que corra la validación (`default` a nivel raíz del schema no es una opción
      // en modo estricto de Fastify).
      preValidation: (request, _reply, done) => {
        if (request.body === undefined) {
          request.body = {};
        }
        done();
      },
      schema: {
        summary: "Cancelar un envío",
        description:
          "MOVO-29 (alcance acotado en MOVO-108, ver CLAUDE.md): cancela un envío " +
          "propio desde awaiting_receiver_confirmation, published o assignment_pending " +
          "-- ninguno de los tres tiene fondos confirmados, así que no aplica " +
          "penalización. Cancelar desde assigned todavía no está soportado (requiere " +
          "una política de penalización real en svc-payments). Solo el emisor puede " +
          "cancelar. Si el envío estaba published o assignment_pending, se notifica a " +
          "cada transportista con una oferta pending sobre él.",
        tags: ["shipments"],
        params: shipmentsSchemas.shipmentIdParam,
        body: shipmentsSchemas.cancelShipmentBody,
        response: {
          200: shipmentsSchemas.shipmentResponse,
          401: shipmentsSchemas.errorResponse,
          403: shipmentsSchemas.errorResponse,
          404: shipmentsSchemas.errorResponse,
          409: shipmentsSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      const callerId = requireUserIdFromHeader(request);
      const { id } = request.params as { id: string };
      const { reason } = request.body as { reason?: string };
      const shipment = await service.cancelShipment(id, callerId, reason);
      return toShipmentDto(shipment);
    }
  );

  app.post(
    "/:id/accept",
    {
      schema: {
        summary: "Aceptar un envío (receptor)",
        description:
          "MOVO-129 (backend de MOVO-16): transiciona el envío de awaiting_receiver_confirmation " +
          "a published. Solo el receptor designado puede llamar a este endpoint. El receptor " +
          "no puede editar ningún dato del envío (body vacío). Requiere al menos 2 fotos de creación " +
          "cargadas (409 si faltan fotos o si el envío no está en awaiting_receiver_confirmation). " +
          "Dispara notificación push best-effort al emisor.",
        tags: ["shipments"],
        params: shipmentsSchemas.shipmentIdParam,
        // Body vacío u omitido: se declara nullable para que un cliente que
        // mande content-type: application/json sin payload no reviente con
        // FST_ERR_CTP_EMPTY_JSON_BODY (mismo criterio que /:id/reject).
        body: shipmentsSchemas.acceptShipmentBody,
        response: {
          200: shipmentsSchemas.shipmentResponse,
          400: shipmentsSchemas.errorResponse,
          401: shipmentsSchemas.errorResponse,
          403: shipmentsSchemas.errorResponse,
          404: shipmentsSchemas.errorResponse,
          409: shipmentsSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      const callerId = requireUserIdFromHeader(request);
      const { id } = request.params as { id: string };
      const shipment = await service.acceptShipment(id, callerId);
      return toShipmentDto(shipment);
    }
  );

  app.post(
    "/:id/reject",
    {
      schema: {
        summary: "Rechazar un envío (receptor)",
        description:
          "MOVO-129 (backend de MOVO-16): transiciona el envío de awaiting_receiver_confirmation " +
          "a rejected_by_receiver (terminal). Solo el receptor designado puede llamar a este endpoint. " +
          "Body opcional { reason: string } (máx 500 chars) persistido en shipment_events. " +
          "Dispara notificación push best-effort al emisor.",
        tags: ["shipments"],
        params: shipmentsSchemas.shipmentIdParam,
        body: shipmentsSchemas.rejectShipmentBody,
        response: {
          200: shipmentsSchemas.shipmentResponse,
          400: shipmentsSchemas.errorResponse,
          401: shipmentsSchemas.errorResponse,
          403: shipmentsSchemas.errorResponse,
          404: shipmentsSchemas.errorResponse,
          409: shipmentsSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      const callerId = requireUserIdFromHeader(request);
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as { reason?: string };
      const shipment = await service.rejectShipment(id, callerId, body.reason);
      return toShipmentDto(shipment);
    }
  );
}
