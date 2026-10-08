import fp from "fastify-plugin";
import { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ApiError } from "@movo/shared";
import { randomUUID } from "node:crypto";

declare module "fastify" {
  interface FastifyRequest {
    requestId: string;
  }
}

/**
 * Mismo formato único de error que el gateway y el resto de los servicios
 * (`ApiError.toJSON()` + `requestId`). Versión mínima de la de movo-svc-shipments:
 * este servicio todavía no tiene errores de dominio propios que traducir.
 */
export default fp(async (app: FastifyInstance) => {
  app.addHook("onRequest", async (request: FastifyRequest) => {
    request.requestId = request.headers["x-request-id"]?.toString() || randomUUID();
  });

  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    const requestId = request.requestId;

    if (error instanceof ApiError) {
      reply.code(error.statusCode).send({ ...error.toJSON(), requestId });
      return;
    }

    if (error.validation) {
      const apiError = new ApiError(400, "VALIDATION_FAILED", error.message);
      reply.code(400).send({ ...apiError.toJSON(), requestId });
      return;
    }

    request.log.error({ err: error, requestId, method: request.method }, "Unhandled error");
    const apiError = new ApiError(500, "INTERNAL_ERROR", "Internal server error");
    reply.code(500).send({ ...apiError.toJSON(), requestId });
  });
});
