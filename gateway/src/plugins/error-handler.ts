import fp from "fastify-plugin";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ApiError } from "@movo/shared";
import { randomUUID } from "node:crypto";

declare module "fastify" {
  interface FastifyRequest {
    requestId: string;
  }
}


export default fp(async (app: FastifyInstance) => {
  // Permite generar un ID único para cada request y manejar errores de manera centralizada en la aplicación Fastify.
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

    // @fastify/rate-limit no tira ApiError, tira un Error genérico con
    // statusCode 429 pegado. Es el único error de una librería externa que
    // esperamos que llegue hasta acá con un status ya decidido por ella
    // misma — lo normalizamos al formato único en vez de tratarlo como 500.
    if ("statusCode" in error && (error as { statusCode?: number }).statusCode === 429) {
      reply.code(429).send({
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message: "Too many requests, please try again later",
          statusCode: 429,
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
