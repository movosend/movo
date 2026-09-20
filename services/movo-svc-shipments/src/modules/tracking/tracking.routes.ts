import { FastifyInstance, FastifyPluginOptions, FastifyRequest } from "fastify";
import { ApiError } from "@movo/shared";
import type { WebSocket } from "ws";
import { createShipmentRepository, ShipmentRepository } from "../../repositories/shipment-repository";
import { authorizeRealtimeConnection, isTrackingClosedForShipment } from "../../services/realtime-authorizer";
import { TRACKING_STATUS_CLOSED_WS_CODE } from "../../plugins/realtime";

export interface TrackingRoutesOptions extends FastifyPluginOptions {
  /** Override solo para tests de integración -- evita depender de Postgres real para
   * probar el rechazo de una conexión WS, mismo criterio que el resto de los módulos. */
  shipmentRepository?: ShipmentRepository;
}

interface TrackParams {
  id: string;
}

/** Cada cuánto se manda un `ping` de protocolo para mantener viva la conexión detrás de
 * nginx/Cloudflare (recomendación de review sobre PR #170, comentario en MOVO-201/Linear)
 * y para detectar un cliente colgado (sin `pong`, el socket se termina). El `ping`/`pong`
 * es a nivel de protocolo WS -- `@fastify/http-proxy` ya lo reenvía de forma transparente
 * entre el gateway y el cliente sin ningún cambio ahí (ver `proxyWebSockets` en su código
 * fuente), así que alcanza con emitirlo del lado de `svc-shipments`. */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * MOVO-201: implementación real del canal de tiempo real (reemplaza la PoC de MOVO-200,
 * `tracking-poc.routes.ts`) -- `GET /shipments/:id/track` (WS). A diferencia de la PoC:
 * - Se conecta a través del gateway (`gateway/src/routes/index.ts` proxea el upgrade y
 *   reenvía `x-user-*`), no solo directo al servicio -- pero sigue validando el JWT acá
 *   mismo (no confía en `x-user-*` para esto): un WS es una conexión de larga duración
 *   que sobrevive más que el TTL de cualquier chequeo hecho solo en el handshake HTTP de
 *   otra ruta, así que autenticar con el JWT real (no derivado) es más estricto, no
 *   redundante.
 * - Cierra la conexión sola si el envío ya está en un estado que corta el tracking al
 *   conectar (AC4), y también si lo alcanza mientras el socket sigue abierto (vía
 *   `realtime.ts`, que escucha `shipment-status-events`).
 * - Registra el socket en `app.realtimeRegistry` (AC8) en vez de empujar una posición de
 *   muestra hardcodeada -- la ingesta real de GPS (MOVO-202) es quien va a publicar acá,
 *   fuera de alcance de este ticket.
 * - Heartbeat ping/pong (ver `HEARTBEAT_INTERVAL_MS`).
 *
 * Reconexión (AC5): no hay ningún estado de sesión cacheado entre conexiones -- cada
 * upgrade nuevo vuelve a correr esta misma función desde cero, así que un cliente que
 * reconecta automáticamente ya revalida token y autorización sin código adicional.
 */
export default async function trackingRoutes(app: FastifyInstance, opts: TrackingRoutesOptions) {
  const shipmentRepository = opts.shipmentRepository ?? createShipmentRepository(app.db);

  app.get<{ Params: TrackParams }>(
    "/:id/track",
    { websocket: true, schema: { hide: true } },
    async (socket: WebSocket, request: FastifyRequest<{ Params: TrackParams }>) => {
      const shipmentId = request.params.id;

      let shipment;
      try {
        const authorized = await authorizeRealtimeConnection(
          shipmentRepository,
          request.headers.authorization,
          shipmentId
        );
        shipment = authorized.shipment;
      } catch (err) {
        const statusCode = err instanceof ApiError ? err.statusCode : 500;
        const message = err instanceof ApiError ? err.message : "Error interno.";
        app.log.warn({ err, shipmentId }, "realtime: conexión de tracking rechazada");
        // Códigos de cierre WS privados (>=4000, RFC 6455) -- no hay upgrade HTTP
        // que rechazar con un status code normal, el error viaja en el cierre.
        const closeCode = statusCode === 401 ? 4001 : statusCode === 403 ? 4003 : statusCode === 404 ? 4004 : 4000;
        socket.close(closeCode, message);
        return;
      }

      if (isTrackingClosedForShipment(shipment)) {
        app.log.info({ shipmentId, status: shipment.status }, "realtime: tracking ya cerrado para este envío");
        socket.close(TRACKING_STATUS_CLOSED_WS_CODE, `El envío ya está en estado '${shipment.status}'.`);
        return;
      }

      app.realtimeRegistry.register(shipmentId, socket);
      app.log.info(
        { shipmentId, activeConnections: app.realtimeRegistry.activeConnections(shipmentId) },
        "realtime: conexión de tracking aceptada"
      );

      socket.send(JSON.stringify({ type: "connected", shipmentId }));

      let isAlive = true;
      socket.on("pong", () => {
        isAlive = true;
      });
      const heartbeat = setInterval(() => {
        if (!isAlive) {
          app.log.warn({ shipmentId }, "realtime: sin pong del cliente, terminando conexión");
          socket.terminate();
          return;
        }
        isAlive = false;
        socket.ping();
      }, HEARTBEAT_INTERVAL_MS);
      heartbeat.unref();

      socket.on("close", () => {
        clearInterval(heartbeat);
        app.realtimeRegistry.unregister(shipmentId, socket);
        app.log.info({ shipmentId }, "realtime: cliente de tracking desconectado");
      });

      // Sin este listener, un corte abrupto de la conexión TCP (ej. ECONNRESET)
      // mientras se envía data puede escalar a una excepción no capturada del
      // EventEmitter.
      socket.on("error", (err: Error) => {
        app.log.warn({ err, shipmentId }, "realtime: error de socket de tracking");
      });
    }
  );
}
