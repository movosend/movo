import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from "fastify";
import { OfferStatus } from "@movo/shared";
import { createOffersService } from "./offers.service";
import { offersSchemas } from "./offers.schema";
import { requireUserIdFromHeader } from "../../utils/require-user-id";
import { createNotificationsClient, NotificationsClient } from "../../adapters/notifications-client";
import { createShipmentRepository } from "../../repositories/shipment-repository";
import { createOfferRepository } from "../../repositories/offer-repository";
import { OfferWithShipmentContext } from "../../models/offer";
import { toOfferDto } from "./offer.dto";

export interface OffersRoutesOptions extends FastifyPluginOptions {
  /** Override solo para tests de integración -- mismo criterio que
   * `ShipmentsRoutesOptions.notificationsClient`. */
  notificationsClient?: NotificationsClient;
}

/**
 * `offeredDate`/`shipment.pickupDate` son columnas `@db.Date` -- ancladas a UTC (valor
 * de calendario, no un instante) -- mismo gotcha de timezone que `toShipmentDto` en
 * shipments.routes.ts. Se formatean acá a string ya recortado en vez de dejar que el
 * serializador `format: "date"` de fast-json-stringify les reste el offset del proceso.
 */
function toMyOfferDto(offer: OfferWithShipmentContext) {
  return {
    ...offer,
    offeredDate: offer.offeredDate.toISOString().slice(0, 10),
    shipment: {
      ...offer.shipment,
      pickupDate: offer.shipment.pickupDate.toISOString().slice(0, 10),
    },
  };
}

export default async function offersRoutes(app: FastifyInstance, opts: OffersRoutesOptions) {
  const notificationsClient = opts.notificationsClient ?? createNotificationsClient(app.config);
  const offerRepository = createOfferRepository(app.db);
  const shipmentRepository = createShipmentRepository(app.db);
  const service = createOffersService(offerRepository, shipmentRepository, notificationsClient, app.log);

  app.get(
    "/mine",
    {
      schema: {
        summary: "Mis ofertas (transportista)",
        description:
          "MOVO-145 (backend de MOVO-109): lista paginada de las ofertas del transportista " +
          "autenticado, más recientes primero. El carrierId sale SIEMPRE del header " +
          "x-user-id inyectado por el gateway, nunca de un query param (AC1). El status " +
          "de cada ítem es el EFECTIVO -- una pending vencida se reporta expired sin que " +
          "la fila cambie en base (AC2/AC11). Cada ítem trae el contexto mínimo del envío " +
          "(direcciones, fecha de retiro, status real) resuelto en la misma query (AC4); " +
          "una oferta accepted expone el status real del envío, que ya no es published " +
          "(AC5).",
        tags: ["offers"],
        querystring: offersSchemas.listMineQuery,
        response: {
          200: offersSchemas.listMineResponse,
          401: offersSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      const carrierId = requireUserIdFromHeader(request);
      const { page, limit, status } = request.query as { page: number; limit: number; status?: OfferStatus };
      const result = await service.listMyOffers(carrierId, page, limit, status);
      return { ...result, items: result.items.map(toMyOfferDto) };
    }
  );

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
