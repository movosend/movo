import fp from "fastify-plugin";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ApiError, ApiErrorCode } from "@movo/shared";
import { randomUUID } from "node:crypto";

declare module "fastify" {
  interface FastifyRequest {
    requestId: string;
  }
}

export default fp(async (app: FastifyInstance) => {
  // Mismo formato único de error que el gateway (ver gateway/src/plugins/error-handler.ts)
  // para que un cliente reciba la misma forma de respuesta sin importar qué servicio la generó.
  app.addHook("onRequest", async (request: FastifyRequest) => {
    request.requestId =
      request.headers["x-request-id"]?.toString() || randomUUID();
  });

  app.setErrorHandler((error: Error, request: FastifyRequest, reply: FastifyReply) => {
    const requestId = request.requestId;

    if (error instanceof ApiError) {
      reply.code(error.statusCode).send({
        ...error.toJSON(),
        requestId,
      });
      return;
    }

    // Errores de validación de schema (AJV) de Fastify: normalizarlos al
    // formato único en vez de dejar pasar el 400 genérico de Fastify.
    if ("validation" in error && Array.isArray((error as { validation?: unknown }).validation)) {
      const code: ApiErrorCode = "VALIDATION_FAILED";
      reply.code(400).send({
        error: {
          code,
          message: error.message,
          statusCode: 400,
        },
        requestId,
      });
      return;
    }

    app.log.error(
      {
        err: error,
        requestId,
        url: request.url,
        method: request.method,
      },
      "Unhandled error"
    );

    reply.code(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
        statusCode: 500,
      },
      requestId,
    });
  });
});
