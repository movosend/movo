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
import { createShipmentRepository } from "../../repositories/shipment-repository";
import { createOfferRepository } from "../../repositories/offer-repository";
import { Shipment, ShipmentEvent } from "../../models/shipment";

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
   * real levantado (MOVO-108), mismo criterio que `usersClient`. */
  notificationsClient?: NotificationsClient;
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
  const notificationsClient = opts.notificationsClient ?? createNotificationsClient(app.config, app.log);
  const repository = createShipmentRepository(app.db);
  const offerRepository = createOfferRepository(app.db);
  const service = createShipmentsService(repository, usersClient, offerRepository, notificationsClient);
  const photosService = createPhotosService(repository, storageProvider);

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

  app.get(
    "/:id",
    {
      schema: {
        summary: "Detalle de un envío",
        description:
          "AC8 de MOVO-80: accesible únicamente para el emisor, el receptor o un admin. " +
          "Un usuario ajeno recibe 403, nunca 404 con datos filtrados.",
        tags: ["shipments"],
        params: shipmentsSchemas.shipmentIdParam,
        response: {
          200: shipmentsSchemas.shipmentResponse,
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
}
