import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from "fastify";
import {
  AdminBlock,
  AdminChatPage,
  AdminShipmentDetailResponse,
  AdminShipmentPage,
  AdminShipmentPartyCard,
  AdminShipmentPayment,
  AdminShipmentTracking,
  ApiError,
  ChatParticipantRole,
} from "@movo/shared";
import { RequestContext } from "../../adapters/internal-client";
import { requireAdmin } from "../../utils/require-admin";
import { shipmentsSchemas } from "./shipments.schema";

/**
 * Un bloque del detalle que vive en otro servicio: si ese servicio no responde, el bloque viene en
 * `null` con su causa y el resto del detalle se devuelve igual (MOVO-325, AC9).
 */
async function block<T>(load: () => Promise<T>): Promise<AdminBlock<T>> {
  try {
    return { data: await load(), error: null };
  } catch (error) {
    if (error instanceof ApiError) return { data: null, error: { code: error.code, message: error.message } };
    return { data: null, error: { code: "BLOCK_UNAVAILABLE", message: "No se pudo obtener este bloque." } };
  }
}

/**
 * MOVO-325 (backend de MOVO-33): envíos para el panel. `svc-shipments` es el dueño de los datos
 * (endpoints internos `/internal/admin/shipments*`); acá se exige el rol admin y se completa el
 * detalle con `svc-users` (partes) y `svc-payments` (pago). Son lecturas: sin bitácora ni regla de
 * conflicto de interés (AC9 de MOVO-33).
 */
export default async function shipmentsRoutes(app: FastifyInstance, _opts: FastifyPluginOptions) {
  const errors = {
    400: shipmentsSchemas.errorResponse,
    401: shipmentsSchemas.errorResponse,
    403: shipmentsSchemas.errorResponse,
    404: shipmentsSchemas.errorResponse,
    502: shipmentsSchemas.errorResponse,
  };

  const notFound = () => new ApiError(404, "NOT_FOUND", "Envío no encontrado.");

  app.get(
    "/shipments",
    {
      schema: {
        tags: ["admin"],
        summary: "Envíos de la plataforma",
        description:
          "Por defecto los activos (todos los no terminales, incluidos `awaiting_receiver_confirmation` y " +
          "`rejected_by_receiver`); `status` o `group` piden otros, cerrados incluidos. Ordenado por último " +
          "cambio de estado, paginado por cursor. `q` busca por código, nombre de cualquiera de las partes y " +
          "dirección, sin tildes ni mayúsculas; `city` es la ciudad del retiro; `from`/`to` acotan el último " +
          "cambio de estado. `counts` trae el total de cada pestaña con los mismos filtros de búsqueda (sin " +
          "`group` ni `status`); `all` son los activos.",
        querystring: shipmentsSchemas.listQuery,
        response: { 200: shipmentsSchemas.listResponse, ...errors },
      },
    },
    async (request: FastifyRequest): Promise<AdminShipmentPage> => {
      requireAdmin(request);
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(request.query as Record<string, string | number | boolean | undefined>)) {
        if (value !== undefined) query.set(key, String(value));
      }
      return app.shipmentsClient.listAdminShipments(query, { requestId: request.requestId });
    },
  );

  app.get(
    "/shipments/:id",
    {
      schema: {
        tags: ["admin"],
        summary: "Detalle completo de un envío",
        description:
          "El envío y sus bloques: eventos, fotos (URL firmada de vida corta) y ofertas (todas, con el desglose " +
          "del precio) de `svc-shipments`, pago de " +
          "`svc-payments` y partes con verificación y reputación de `svc-users`. Un bloque que no se pudo " +
          "obtener viene con `data: null` y su `error`, sin tumbar el resto. `payment.data` es `null` sin error " +
          "si nunca se intentó el pago.",
        params: shipmentsSchemas.idParam,
        response: { 200: shipmentsSchemas.detailResponse, ...errors },
      },
    },
    async (request: FastifyRequest): Promise<AdminShipmentDetailResponse> => {
      requireAdmin(request);
      const { id } = request.params as { id: string };
      const ctx: RequestContext = { requestId: request.requestId };

      const shipment = await app.shipmentsClient.getAdminShipment(id, ctx);
      if (!shipment) throw notFound();

      const [events, photos, offers, payment, parties] = await Promise.all([
        block(async () => (await app.shipmentsClient.getAdminShipmentEvents(id, ctx)) ?? []),
        block(async () => (await app.shipmentsClient.getAdminShipmentPhotos(id, ctx)) ?? []),
        block(async () => (await app.shipmentsClient.getAdminShipmentOffers(id, ctx)) ?? []),
        block<AdminShipmentPayment>(() => app.paymentsClient.findHoldByShipment(id, ctx)),
        block(async (): Promise<AdminShipmentPartyCard[]> => {
          // Una persona puede cumplir dos roles (p. ej. emisor y receptor): una ficha por rol.
          const roles: Array<[ChatParticipantRole, string]> = [["sender", shipment.sender.id]];
          if (shipment.carrier) roles.push(["carrier", shipment.carrier.id]);
          roles.push(["receiver", shipment.receiver.id]);
          const cards = await app.usersClient.getPartyCards([...new Set(roles.map(([, userId]) => userId))], ctx);
          return roles.flatMap(([role, userId]) => {
            const card = cards.find((candidate) => candidate.id === userId);
            return card ? [{ ...card, role }] : [];
          });
        }),
      ]);

      return { shipment, events, photos, offers, payment, parties };
    },
  );

  app.get(
    "/shipments/:id/chat/messages",
    {
      schema: {
        tags: ["admin"],
        summary: "Chat del envío en solo lectura",
        description:
          "Todo el hilo del más reciente al más antiguo, con el contenido sin ocultar por bloqueos ni por el " +
          "inicio de la última asignación (ADR-040: es evidencia). Cada mensaje trae `moderated` y el rol de su " +
          "autor; `reports` dice quién reportó la conversación; `partiesAccess` si las partes pueden escribir " +
          "(`open`), solo leer (`read_only`) o ya no hay conversación (`closed`); `events` son los eventos del envío para intercalar por fecha.",
        params: shipmentsSchemas.idParam,
        querystring: shipmentsSchemas.chatQuery,
        response: { 200: shipmentsSchemas.chatResponse, ...errors },
      },
    },
    async (request: FastifyRequest): Promise<AdminChatPage> => {
      requireAdmin(request);
      const { id } = request.params as { id: string };
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(request.query as Record<string, string | number | undefined>)) {
        if (value !== undefined) query.set(key, String(value));
      }
      const page = await app.shipmentsClient.getAdminShipmentChat(id, query, { requestId: request.requestId });
      if (!page) throw notFound();
      return page;
    },
  );

  app.get(
    "/shipments/:id/tracking",
    {
      schema: {
        tags: ["admin"],
        summary: "Seguimiento del envío para el mapa",
        description:
          "Ruta planificada, traza y, con el envío en camino, última posición y métricas (velocidad promedio de " +
          "5 min, km restantes, % y ETA). La posición solo se ve con el transportista en viaje (`live`). Sin un " +
          "ping reciente, `signalLost` con la hora del último y sin velocidad ni ETA. El panel lo pide por " +
          "polling cada `pollIntervalSeconds` (MOVO-327); la respuesta no se cachea.",
        params: shipmentsSchemas.idParam,
        response: { 200: shipmentsSchemas.trackingResponse, ...errors },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply): Promise<AdminShipmentTracking> => {
      requireAdmin(request);
      const { id } = request.params as { id: string };
      const tracking = await app.shipmentsClient.getAdminShipmentTracking(id, { requestId: request.requestId });
      if (!tracking) throw notFound();
      reply.header("Cache-Control", "no-store");
      return tracking;
    },
  );
}
