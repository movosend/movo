import { FastifyInstance, FastifyPluginOptions, FastifyRequest } from "fastify";
import { OfferStatus } from "@movo/shared";
import { createOffersService } from "./offers.service";
import { offersSchemas } from "./offers.schema";
import { requireUserIdFromHeader } from "../../utils/require-user-id";
import { createOfferRepository } from "../../repositories/offer-repository";
import { OfferWithShipmentContext } from "../../models/offer";

export type OffersRoutesOptions = FastifyPluginOptions;

/**
 * `offeredDate`/`shipment.pickupDate` son columnas `@db.Date` -- ancladas a UTC (valor
 * de calendario, no un instante) -- mismo gotcha de timezone que `toShipmentDto` en
 * shipments.routes.ts. Se formatean acá a string ya recortado en vez de dejar que el
 * serializador `format: "date"` de fast-json-stringify les reste el offset del proceso.
 */
function toOfferDto(offer: OfferWithShipmentContext) {
  return {
    ...offer,
    offeredDate: offer.offeredDate.toISOString().slice(0, 10),
    shipment: {
      ...offer.shipment,
      pickupDate: offer.shipment.pickupDate.toISOString().slice(0, 10),
    },
  };
}

export default async function offersRoutes(app: FastifyInstance, _opts: OffersRoutesOptions) {
  const offerRepository = createOfferRepository(app.db);
  const service = createOffersService(offerRepository);

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
      return { ...result, items: result.items.map(toOfferDto) };
    }
  );
}
