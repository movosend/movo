import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from "fastify";
import { createShipmentsService, CreateShipmentServiceInput } from "./shipments.service";
import { shipmentsSchemas } from "./shipments.schema";
import { requireUserIdFromHeader } from "../../utils/require-user-id";
import { getUserRolesFromHeader } from "../../utils/get-user-roles";
import { createUsersClient, UsersClient } from "../../adapters/users-client";
import { createShipmentRepository } from "../../repositories/shipment-repository";
import { Shipment } from "../../models/shipment";

export interface ShipmentsRoutesOptions extends FastifyPluginOptions {
  /** Override solo para tests de integración — evita depender de un `movo-svc-users`
   * real levantado, mismo criterio que `storageProvider`/`diditClient` en
   * movo-svc-users. */
  usersClient?: UsersClient;
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

export default async function shipmentsRoutes(app: FastifyInstance, opts: ShipmentsRoutesOptions) {
  const usersClient = opts.usersClient ?? createUsersClient(app.config);
  const repository = createShipmentRepository(app.db);
  const service = createShipmentsService(repository, usersClient);

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
}
