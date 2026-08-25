import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from "fastify";
import { createOffersService } from "./offers.service";
import { offersSchemas } from "./offers.schema";
import { requireUserIdFromHeader } from "../../utils/require-user-id";
import { createNotificationsClient, NotificationsClient } from "../../adapters/notifications-client";
import { createShipmentRepository } from "../../repositories/shipment-repository";
import { createOfferRepository } from "../../repositories/offer-repository";
import { Offer } from "../../models/offer";

export interface OffersRoutesOptions extends FastifyPluginOptions {
  /** Override solo para tests de integración -- mismo criterio que
   * `ShipmentsRoutesOptions.notificationsClient`. */
  notificationsClient?: NotificationsClient;
}

function toOfferDto(offer: Offer) {
  return {
    ...offer,
    offeredDate: offer.offeredDate.toISOString(),
    expiresAt: offer.expiresAt ? offer.expiresAt.toISOString() : null,
    createdAt: offer.createdAt.toISOString(),
    respondedAt: offer.respondedAt ? offer.respondedAt.toISOString() : null,
  };
}

export default async function offersRoutes(app: FastifyInstance, opts: OffersRoutesOptions) {
  const notificationsClient = opts.notificationsClient ?? createNotificationsClient(app.config);
  const offerRepository = createOfferRepository(app.db);
  const shipmentRepository = createShipmentRepository(app.db);
  const service = createOffersService(offerRepository, shipmentRepository, notificationsClient, app.log);

  app.post(
    "/:id/accept",
    {
      schema: {
        summary: "Aceptar una oferta (emisor)",
        description:
          "AC6/AC7/AC9 de MOVO-144: el envío pasa a assignment_pending con el " +
          "transportista elegido y las demás ofertas pending del mismo envío pasan a " +
          "superseded (todo en una transacción atómica, ver offer-repository.ts). Solo " +
          "el emisor del envío dueño de la oferta puede aceptar. 409 si el envío ya no " +
          "está disponible para asignar, si otra operación concurrente ya modificó la " +
          "oferta, o si la oferta está vencida o ya resuelta.",
        tags: ["offers"],
        params: offersSchemas.offerIdParam,
        response: {
          200: offersSchemas.offerResponse,
          400: offersSchemas.errorResponse,
          401: offersSchemas.errorResponse,
          403: offersSchemas.errorResponse,
          404: offersSchemas.errorResponse,
          409: offersSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const callerId = requireUserIdFromHeader(request);
      const { id } = request.params as { id: string };
      const offer = await service.acceptOffer(id, callerId);
      reply.code(200);
      return toOfferDto(offer);
    }
  );

  app.post(
    "/:id/reject",
    {
      schema: {
        summary: "Rechazar una oferta (emisor)",
        description:
          "AC8/AC9 de MOVO-144: rechazo puntual -- la oferta queda rejected, el envío " +
          "sigue published y el transportista puede volver a ofertar (fila nueva). Solo " +
          "el emisor del envío dueño de la oferta puede rechazar.",
        tags: ["offers"],
        params: offersSchemas.offerIdParam,
        response: {
          200: offersSchemas.offerResponse,
          400: offersSchemas.errorResponse,
          401: offersSchemas.errorResponse,
          403: offersSchemas.errorResponse,
          404: offersSchemas.errorResponse,
          409: offersSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      const callerId = requireUserIdFromHeader(request);
      const { id } = request.params as { id: string };
      const offer = await service.rejectOffer(id, callerId);
      return toOfferDto(offer);
    }
  );
}
