import { FastifyInstance, FastifyPluginOptions, FastifyRequest } from "fastify";
import {
  createReceiverTransfersService,
  ReceiverTransfersService,
  toInvitationDto,
  toTransferDto,
} from "./receiver-transfers.service";
import { receiverTransfersSchemas } from "./receiver-transfers.schema";
import { requireUserIdFromHeader } from "../../utils/require-user-id";
import { getUserRolesFromHeader } from "../../utils/get-user-roles";
import { createShipmentRepository } from "../../repositories/shipment-repository";
import { createReceiverTransferRepository } from "../../repositories/receiver-transfer-repository";
import { createUsersClient, UsersClient } from "../../adapters/users-client";
import { createNotificationsClient, NotificationsClient } from "../../adapters/notifications-client";

export interface ReceiverTransfersRoutesOptions extends FastifyPluginOptions {
  /** Override solo para tests de integración, mismo criterio que shipments.routes.ts. */
  usersClient?: UsersClient;
  notificationsClient?: NotificationsClient;
}

/** Arma el servicio con las dependencias reales de la app (o los overrides de test). */
export function buildReceiverTransfersService(
  app: FastifyInstance,
  opts: { usersClient?: UsersClient; notificationsClient?: NotificationsClient } = {}
): ReceiverTransfersService {
  return createReceiverTransfersService({
    shipmentRepository: createShipmentRepository(app.db),
    transferRepository: createReceiverTransferRepository(app.db),
    usersClient: opts.usersClient ?? createUsersClient(app.config),
    notificationsClient: opts.notificationsClient ?? createNotificationsClient(app.config),
    redis: app.redis,
    logger: app.log,
    timeoutHours: app.config.RECEIVER_TRANSFER_TIMEOUT_HOURS,
  });
}

const errors = {
  400: receiverTransfersSchemas.errorResponse,
  401: receiverTransfersSchemas.errorResponse,
  403: receiverTransfersSchemas.errorResponse,
  404: receiverTransfersSchemas.errorResponse,
  409: receiverTransfersSchemas.errorResponse,
};

/**
 * MOVO-275 (ADR-038): rutas que cuelgan de un envío (prefijo `/shipments`, mismo
 * criterio que ratings/handshake).
 */
export async function shipmentReceiverTransferRoutes(app: FastifyInstance, opts: ReceiverTransfersRoutesOptions) {
  const service = buildReceiverTransfersService(app, opts);

  app.post(
    "/:id/receiver-transfer",
    {
      schema: {
        summary: "Pedir que otra persona reciba el envío (receptor)",
        description:
          "MOVO-275: el receptor actual de un envío aceptado (published hasta in_transit, antes " +
          "de que empiece el handshake de entrega) invita a otra persona con KYC aprobado a " +
          "recibir en su lugar. La invitada tiene RECEIVER_TRANSFER_TIMEOUT_HOURS para aceptar. " +
          "El emisor recibe una push informativa. 409 SHIPMENT_RECEIVER_TRANSFER_LIMIT si ya " +
          "hubo una transferencia completada, SHIPMENT_RECEIVER_TRANSFER_PENDING si hay una " +
          "pendiente, SHIPMENT_RECEIVER_TRANSFER_NOT_ALLOWED fuera de la ventana; 422 " +
          "SHIPMENT_RECEIVER_TRANSFER_INVALID_TARGET (receptor actual, emisor o transportista) " +
          "o SHIPMENT_RECEIVER_KYC_NOT_APPROVED; 403 USER_BLOCKED si hay un bloqueo con el emisor.",
        tags: ["receiver-transfers"],
        params: receiverTransfersSchemas.shipmentIdParam,
        body: receiverTransfersSchemas.requestTransferBody,
        response: {
          201: receiverTransfersSchemas.receiverTransferResponse,
          ...errors,
          422: receiverTransfersSchemas.errorResponse,
          502: receiverTransfersSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest, reply) => {
      const callerId = requireUserIdFromHeader(request);
      const { id } = request.params as { id: string };
      const body = request.body as { newReceiverId: string; reason?: string };
      const transfer = await service.requestTransfer({
        shipmentId: id,
        callerId,
        newReceiverId: body.newReceiverId,
        reason: body.reason ?? null,
      });
      reply.code(201);
      return toTransferDto(transfer);
    }
  );

  app.get(
    "/:id/receiver-transfers",
    {
      schema: {
        summary: "Transferencias de receptor de un envío (línea de tiempo)",
        description:
          "MOVO-275 AC7: solicitudes de transferencia del envío en orden cronológico, para " +
          "intercalar en la línea de tiempo como un item por solicitud. El emisor y quien pidió " +
          "cada solicitud las ven todas; el transportista y el receptor vigente solo la " +
          "completada. Mismo acceso que GET /shipments/:id/events (incluye al receptor que " +
          "transfirió, en solo lectura).",
        tags: ["receiver-transfers"],
        params: receiverTransfersSchemas.shipmentIdParam,
        response: {
          200: receiverTransfersSchemas.receiverTransferListResponse,
          ...errors,
        },
      },
    },
    async (request: FastifyRequest) => {
      const callerId = requireUserIdFromHeader(request);
      const callerRoles = getUserRolesFromHeader(request);
      const { id } = request.params as { id: string };
      const transfers = await service.listForShipment(id, callerId, callerRoles);
      return transfers.map(toTransferDto);
    }
  );
}

/** MOVO-275: rutas de la solicitud en sí (prefijo propio `/receiver-transfers`). */
export default async function receiverTransfersRoutes(app: FastifyInstance, opts: ReceiverTransfersRoutesOptions) {
  const service = buildReceiverTransfersService(app, opts);

  // Ruta estática, antes de "/:id" por claridad (find-my-way ya la prioriza).
  app.get(
    "/invitations",
    {
      schema: {
        summary: "Mis invitaciones para recibir un paquete",
        description:
          "MOVO-275 AC8: invitaciones pendientes y no vencidas donde el usuario es la persona " +
          "invitada, para la card de \"Requiere tu atención\". Más próxima a vencer primero.",
        tags: ["receiver-transfers"],
        response: {
          200: receiverTransfersSchemas.invitationListResponse,
          401: receiverTransfersSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      const callerId = requireUserIdFromHeader(request);
      const invitations = await service.listMyInvitations(callerId);
      return invitations.map(toInvitationDto);
    }
  );

  app.get(
    "/:id",
    {
      schema: {
        summary: "Detalle de una solicitud de transferencia",
        description:
          "MOVO-275: la persona invitada (en cualquier estado, para mostrar si ya no está " +
          "vigente), quien la pidió o el emisor. Incluye lo mínimo del envío para decidir: " +
          "dirección de entrega, paquete, emisor y transportista.",
        tags: ["receiver-transfers"],
        params: receiverTransfersSchemas.transferIdParam,
        response: { 200: receiverTransfersSchemas.invitationResponse, ...errors },
      },
    },
    async (request: FastifyRequest) => {
      const callerId = requireUserIdFromHeader(request);
      const callerRoles = getUserRolesFromHeader(request);
      const { id } = request.params as { id: string };
      return toInvitationDto(await service.getTransfer(id, callerId, callerRoles));
    }
  );

  app.post(
    "/:id/accept",
    {
      schema: {
        summary: "Aceptar recibir el paquete (persona invitada)",
        description:
          "MOVO-275 AC3: en una sola transacción el envío pasa a tener a la persona invitada " +
          "como receptor y la solicitud queda completed. Push al transportista, al emisor y al " +
          "receptor original. 409 SHIPMENT_RECEIVER_TRANSFER_EXPIRED con el plazo vencido " +
          "(aunque el barrido no haya corrido), RECEIVER_TRANSFER_NOT_PENDING si ya se resolvió, " +
          "SHIPMENT_RECEIVER_TRANSFER_NOT_ALLOWED si la entrega ya empezó.",
        tags: ["receiver-transfers"],
        params: receiverTransfersSchemas.transferIdParam,
        body: receiverTransfersSchemas.emptyBody,
        response: { 200: receiverTransfersSchemas.receiverTransferResponse, ...errors, 502: receiverTransfersSchemas.errorResponse },
      },
    },
    async (request: FastifyRequest) => {
      const callerId = requireUserIdFromHeader(request);
      const { id } = request.params as { id: string };
      return toTransferDto(await service.acceptTransfer(id, callerId));
    }
  );

  app.post(
    "/:id/reject",
    {
      schema: {
        summary: "Rechazar la invitación (persona invitada)",
        description:
          "MOVO-275 AC2: la solicitud queda rejected_by_new_receiver y el envío sigue con el " +
          "receptor anterior. Push al receptor original y al emisor. Motivo opcional.",
        tags: ["receiver-transfers"],
        params: receiverTransfersSchemas.transferIdParam,
        body: receiverTransfersSchemas.rejectTransferBody,
        response: { 200: receiverTransfersSchemas.receiverTransferResponse, ...errors },
      },
    },
    async (request: FastifyRequest) => {
      const callerId = requireUserIdFromHeader(request);
      const { id } = request.params as { id: string };
      const body = request.body as { reason?: string } | null;
      return toTransferDto(await service.rejectTransfer(id, callerId, body?.reason ?? null));
    }
  );

  app.post(
    "/:id/cancel",
    {
      schema: {
        summary: "Cancelar la solicitud (receptor que la pidió)",
        description:
          "MOVO-275 AC6: quien pidió la transferencia la cancela mientras está pendiente. " +
          "El paquete lo sigue recibiendo esa persona. Push a la persona invitada.",
        tags: ["receiver-transfers"],
        params: receiverTransfersSchemas.transferIdParam,
        body: receiverTransfersSchemas.emptyBody,
        response: { 200: receiverTransfersSchemas.receiverTransferResponse, ...errors },
      },
    },
    async (request: FastifyRequest) => {
      const callerId = requireUserIdFromHeader(request);
      const { id } = request.params as { id: string };
      return toTransferDto(await service.cancelTransfer(id, callerId));
    }
  );
}
