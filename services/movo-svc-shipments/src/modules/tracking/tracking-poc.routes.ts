import { FastifyInstance, FastifyPluginOptions, FastifyRequest } from "fastify";
import { ApiError, verifyAccessToken } from "@movo/shared";
import { createShipmentRepository, ShipmentRepository } from "../../repositories/shipment-repository";
import { assertShipmentAccess } from "../shipments/assert-shipment-access";

export interface TrackingPocRoutesOptions extends FastifyPluginOptions {
  /** Override solo para tests de integración -- mismo criterio que el resto de los
   * módulos (evita depender de Postgres real para probar el rechazo de conexión). */
  shipmentRepository?: ShipmentRepository;
}

interface TrackParams {
  id: string;
}

/**
 * PoC de MOVO-200/ADR-022 (WebSocket nativo vía `@fastify/websocket`) -- NO es la
 * implementación final del canal de tracking. Cubre únicamente el AC5 del spike:
 * demostrar el mecanismo elegido con un canal real que empuja un mensaje a un
 * cliente, con el JWT validado en el handshake de conexión.
 *
 * Instrucciones para correrla: `docs/tracking-poc/README.md`.
 *
 * Simplificaciones deliberadas frente al esbozo de autenticación/autorización del
 * ADR (AC4), documentadas también en ese README -- las resuelve MOVO-201, el ticket
 * hermano que implementa el canal real:
 * - Conecta DIRECTO a este servicio, sin pasar por el gateway. Por eso valida el
 *   JWT acá mismo con `verifyAccessToken` en vez de confiar en `x-user-*`
 *   (ADR-010 asume que ese trust model empieza en el gateway, que es quien lo
 *   valida hoy para HTTP normal -- acá no hay gateway de por medio todavía).
 * - Autoriza una sola vez al conectar (mismo criterio que AC8 de MOVO-142:
 *   emisor/receptor/admin vía `assertShipmentAccess`, más el transportista
 *   asignado, que ese helper no conoce). Sin salas ni difusión a múltiples
 *   suscriptores del mismo envío.
 * - Empuja una única posición de muestra y deja la conexión abierta a la espera
 *   del cliente -- no hay ingesta real de GPS (ticket hermano de MOVO-11, fuera
 *   de alcance del spike).
 */
export default async function trackingPocRoutes(app: FastifyInstance, opts: TrackingPocRoutesOptions) {
  const shipmentRepository = opts.shipmentRepository ?? createShipmentRepository(app.db);

  app.get<{ Params: TrackParams }>(
    "/:id/track",
    { websocket: true, schema: { hide: true } },
    async (socket, request: FastifyRequest<{ Params: TrackParams }>) => {
      try {
        const authHeader = request.headers.authorization;
        if (!authHeader?.startsWith("Bearer ")) {
          throw new ApiError(401, "AUTH_TOKEN_INVALID", "Falta el header Authorization.");
        }
        const result = verifyAccessToken(authHeader.slice(7));
        if (result.status === "invalid") {
          throw new ApiError(401, "AUTH_TOKEN_INVALID", "Token inválido o vencido.");
        }
        const { sub: callerId, roles: callerRoles } = result.claims;

        const shipment = await shipmentRepository.findById(request.params.id);
        if (!shipment) {
          throw new ApiError(404, "NOT_FOUND", "Envío no encontrado.");
        }
        if (callerId !== shipment.carrierId) {
          assertShipmentAccess(
            shipment,
            callerId,
            callerRoles,
            "No tenés permiso para ver el tracking de este envío."
          );
        }
      } catch (err) {
        const statusCode = err instanceof ApiError ? err.statusCode : 500;
        const message = err instanceof ApiError ? err.message : "Error interno.";
        app.log.warn({ err, shipmentId: request.params.id }, "tracking-poc: conexión rechazada");
        // Códigos de cierre WS privados (>=4000, RFC 6455) -- no hay upgrade HTTP
        // que rechazar con un status code normal, el error viaja en el cierre.
        const closeCode = statusCode === 401 ? 4001 : statusCode === 403 ? 4003 : statusCode === 404 ? 4004 : 4000;
        socket.close(closeCode, message);
        return;
      }

      // AC5: prueba mínima del canal -- una posición de muestra, sin ninguna
      // fuente de GPS real detrás todavía (eso es el ticket hermano de MOVO-11).
      socket.send(
        JSON.stringify({
          type: "position",
          shipmentId: request.params.id,
          lat: -31.4201,
          lng: -64.1888,
          at: new Date().toISOString(),
        })
      );

      socket.on("close", () => {
        app.log.info({ shipmentId: request.params.id }, "tracking-poc: cliente desconectado");
      });

      // Sin este listener, un corte abrupto de la conexión TCP (ej. ECONNRESET)
      // mientras se envía data puede escalar a una excepción no capturada del
      // EventEmitter.
      socket.on("error", (err: Error) => {
        app.log.warn({ err, shipmentId: request.params.id }, "tracking-poc: error de socket");
      });
    }
  );
}
