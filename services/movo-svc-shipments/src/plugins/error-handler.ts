import fp from "fastify-plugin";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ApiError, ApiErrorCode } from "@movo/shared";
import { randomUUID } from "node:crypto";
import { InsufficientCreationPhotosError, InvalidShipmentTransitionError } from "../domain/shipment-state-machine";
import { ShipmentConcurrentModificationError } from "../repositories/shipment-repository";

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

    // Fix de review (PR #76, tmvergara): sin este caso, el gate de AC6 de MOVO-81
    // (`shipment-repository.ts#updateStatus()`) tira un 500 genérico apenas quede
    // alcanzable por HTTP (MOVO-16) en vez del 409 con el código dedicado
    // `SHIPMENT_INSUFFICIENT_CREATION_PHOTOS` que ya existe en `@movo/shared`.
    if (error instanceof InsufficientCreationPhotosError) {
      const apiError = new ApiError(409, "SHIPMENT_INSUFFICIENT_CREATION_PHOTOS", error.message);
      reply.code(apiError.statusCode).send({
        ...apiError.toJSON(),
        requestId,
      });
      return;
    }

    // Mismo gap que InsufficientCreationPhotosError arriba, encontrado al implementar
    // MOVO-29/MOVO-108 (cancelar un envío en un estado sin salida hacia `cancelled`) y
    // confirmado de nuevo por MOVO-129 (doble tap, cancelado, ya aceptado/rechazado):
    // sin este caso tiraba un 500 genérico en vez de un 409 explícito.
    if (error instanceof InvalidShipmentTransitionError) {
      const apiError = new ApiError(409, "SHIPMENT_INVALID_TRANSITION", error.message);
      reply.code(apiError.statusCode).send({
        ...apiError.toJSON(),
        requestId,
      });
      return;
    }

    // MOVO-118: el compare-and-swap de updateStatus() perdió la carrera
    // contra otra transición concurrente sobre el mismo envío — 409 en vez
    // de dejarlo caer al 500 genérico de abajo.
    if (error instanceof ShipmentConcurrentModificationError) {
      const apiError = new ApiError(409, "SHIPMENT_CONCURRENT_MODIFICATION", error.message);
      reply.code(apiError.statusCode).send({
        ...apiError.toJSON(),
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
