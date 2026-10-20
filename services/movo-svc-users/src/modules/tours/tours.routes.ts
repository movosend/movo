import { FastifyInstance, FastifyPluginOptions, FastifyRequest } from "fastify";
import { TourId } from "@movo/shared";
import { createToursService, RecordTourInput } from "./tours.service";
import { toursSchemas } from "./tours.schema";
import { requireUserIdFromHeader } from "../../utils/require-user-id";

/**
 * MOVO-169: `PUT /users/me/tours/:tourId` -- registra que el usuario completó u omitió
 * un tour del tutorial in-app. Ruta protegida bajo `/users` (proxeada por el gateway
 * sin cambios en `routes-map.ts`, mismo criterio que `/users/me/notification-preferences`),
 * el userId sale del header `x-user-id` (ADR-010). La lectura viaja en `GET /users/me`
 * (`tours`), no en un GET propio: el cliente la necesita junto con el perfil al arrancar.
 */
export default async function toursRoutes(app: FastifyInstance, _opts: FastifyPluginOptions) {
  const service = createToursService(app.db);

  app.put(
    "/me/tours/:tourId",
    {
      schema: {
        summary: "Registrar un tour del tutorial",
        description:
          "Upsert idempotente por (usuario, tour) con la versión del tour en el cliente y " +
          "si se completó u omitió. Una versión menor a la ya registrada no pisa el " +
          "registro: devuelve el vigente. Relanzar un tour a mano desde la app no llama a este endpoint.",
        tags: ["users"],
        params: toursSchemas.tourIdParam,
        body: toursSchemas.recordBody,
        response: {
          200: toursSchemas.tourRecord,
          400: toursSchemas.errorResponse,
          401: toursSchemas.errorResponse,
          404: toursSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      const userId = requireUserIdFromHeader(request);
      const { tourId } = request.params as { tourId: TourId };
      const body = request.body as RecordTourInput;
      return service.recordTour(userId, tourId, body);
    },
  );
}
