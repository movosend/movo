import fp from "fastify-plugin";
import websocket from "@fastify/websocket";
import { FastifyInstance } from "fastify";

/**
 * MOVO-200/ADR-022: registra `@fastify/websocket` a nivel de app -- sin esto
 * `{ websocket: true }` en cualquier ruta lanza en el arranque
 * (FST_ERR_MISSING_PLUGIN). Sin opciones propias: la PoC de MOVO-200 es el
 * único consumidor hasta que MOVO-201 (implementación real del canal) defina
 * si hace falta `errorHandler`/`preClose` a nivel de plugin.
 */
export default fp(async (app: FastifyInstance) => {
  await app.register(websocket);
});
