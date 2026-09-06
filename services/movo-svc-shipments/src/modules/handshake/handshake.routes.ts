import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from "fastify";
import { createHandshakeService, GenerateHandshakeResult, ConfirmHandshakeResult } from "./handshake.service";
import { handshakeSchemas } from "./handshake.schema";
import { requireUserIdFromHeader } from "../../utils/require-user-id";
import { createShipmentRepository } from "../../repositories/shipment-repository";
import { createHandshakeRepository } from "../../repositories/handshake-repository";
import { createUsersClient, UsersClient } from "../../adapters/users-client";
import { createFundsReleaseNotifier, FundsReleaseNotifier } from "../../adapters/funds-release-notifier";

export interface HandshakeRoutesOptions extends FastifyPluginOptions {
  /** Override solo para tests de integración -- evita depender de un `movo-svc-users`
   * real levantado, mismo criterio que `usersClient` en shipments.routes.ts. */
  usersClient?: UsersClient;
  /** Override solo para tests de integración -- mismo criterio que `usersClient`. */
  fundsReleaseNotifier?: FundsReleaseNotifier;
}

function toGenerateHandshakeDto(result: GenerateHandshakeResult) {
  return { ...result, expiresAt: result.expiresAt.toISOString() };
}

function toConfirmHandshakeDto(result: ConfirmHandshakeResult) {
  return { ...result, confirmedAt: result.confirmedAt.toISOString() };
}

/**
 * MOVO-158: core del Cryptographic Handshake -- montado con prefix "/shipments"
 * (junto a `shipmentsRoutes`/`ratingsRoutes`, mismo `app.db`/`app.redis`). Módulo
 * propio (no sumado a `shipments.routes.ts`) por el mismo criterio que
 * `ratingsRoutes`: dominio separado, con su propia tabla append-only.
 */
export default async function handshakeRoutes(app: FastifyInstance, opts: HandshakeRoutesOptions) {
  const usersClient = opts.usersClient ?? createUsersClient(app.config);
  const fundsReleaseNotifier = opts.fundsReleaseNotifier ?? createFundsReleaseNotifier(app.config);
  const shipmentRepository = createShipmentRepository(app.db);
  const handshakeRepository = createHandshakeRepository(app.db);
  const service = createHandshakeService(
    shipmentRepository,
    handshakeRepository,
    usersClient,
    app.redis,
    fundsReleaseNotifier,
    app.log
  );

  app.post(
    "/:id/handshake/generate",
    {
      schema: {
        summary: "Generar el QR dinámico del handshake de custodia",
        description:
          "AC1/AC5/AC6 de MOVO-158: lo llama el cedente de la custodia (el emisor en el retiro -- " +
          "envío `assigned` --, el transportista en la entrega -- envío `in_transit`). Genera un " +
          "nonce y lo persiste 15s (TTL) junto a las coordenadas GPS del cedente; devuelve el string " +
          "canónico exacto que el cliente firma con la clave privada del dispositivo (nunca viaja al " +
          "backend, MOVO-157) para armar el QR. Un nuevo /generate invalida cualquier QR anterior " +
          "todavía vigente para el mismo envío/etapa. 403 si el caller no es el cedente correcto; 409 " +
          "HANDSHAKE_INVALID_SHIPMENT_STATE si el envío no está en un estado con handshake pendiente.",
        tags: ["handshake"],
        params: handshakeSchemas.shipmentIdParam,
        body: handshakeSchemas.generateHandshakeBody,
        response: {
          200: handshakeSchemas.generateHandshakeResponse,
          400: handshakeSchemas.errorResponse,
          401: handshakeSchemas.errorResponse,
          403: handshakeSchemas.errorResponse,
          404: handshakeSchemas.errorResponse,
          409: handshakeSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const callerId = requireUserIdFromHeader(request);
      const { id } = request.params as { id: string };
      const body = request.body as { lat: number; lng: number };
      const result = await service.generateHandshake({ shipmentId: id, callerId, ...body });
      reply.code(200);
      return toGenerateHandshakeDto(result);
    }
  );

  app.post(
    "/:id/handshake/confirm",
    {
      schema: {
        summary: "Confirmar el handshake de custodia escaneado",
        description:
          "AC2-AC7 de MOVO-158: lo llama el receptor de la custodia (el transportista asignado en el " +
          "retiro, el receptor en la entrega) con lo escaneado del QR (nonce + firma) y sus propias " +
          "coordenadas GPS. Valida TTL (410 HANDSHAKE_QR_EXPIRED si venció o ya fue superado por un " +
          "QR más nuevo), firma contra la clave pública del cedente (422 HANDSHAKE_INVALID_SIGNATURE) " +
          "y distancia GPS contra el cedente, máximo 100m (422 HANDSHAKE_DISTANCE_EXCEEDED, no toca el " +
          "estado del envío -- reintentable dentro del mismo TTL). Si todo pasa, transiciona el envío " +
          "(assigned->in_transit o in_transit->delivered) y persiste el evento inmutable en " +
          "handshake_events. 409 HANDSHAKE_CEDENTE_KEY_MISSING si quien generó el QR no tiene clave " +
          "de dispositivo registrada; 409 HANDSHAKE_INVALID_SHIPMENT_STATE si el envío no tiene un " +
          "handshake pendiente; 403 si el caller no es el receptor correcto.",
        tags: ["handshake"],
        params: handshakeSchemas.shipmentIdParam,
        body: handshakeSchemas.confirmHandshakeBody,
        response: {
          200: handshakeSchemas.confirmHandshakeResponse,
          400: handshakeSchemas.errorResponse,
          401: handshakeSchemas.errorResponse,
          403: handshakeSchemas.errorResponse,
          404: handshakeSchemas.errorResponse,
          409: handshakeSchemas.errorResponse,
          410: handshakeSchemas.errorResponse,
          422: handshakeSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const callerId = requireUserIdFromHeader(request);
      const { id } = request.params as { id: string };
      const body = request.body as { nonce: string; signature: string; lat: number; lng: number };
      const result = await service.confirmHandshake({ shipmentId: id, callerId, ...body });
      reply.code(200);
      return toConfirmHandshakeDto(result);
    }
  );
}
