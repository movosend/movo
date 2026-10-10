import { FastifyInstance } from "fastify";
import { CreateHoldRequest, HoldCheckoutDataRequest } from "@movo/shared";
import { checkoutDataSchema, createHoldSchema, getHoldSchema, releaseHoldSchema } from "./holds.schema";

/**
 * MOVO-209: endpoints INTERNOS de holds, los consume `movo-svc-shipments` (dueño de la
 * saga, MOVO-210). El mobile nunca les habla directo. No se declaran en
 * `gateway/src/config/routes-map.ts`, así que el gateway no los proxea: solo se alcanzan
 * desde la red interna de Docker (confianza perimetral, ADR-010, mismo criterio que los
 * `/internal/*` de movo-svc-users). Por eso no pasan por el hook de `x-user-id` de
 * `/payments`: el caller es otro servicio, no un usuario.
 */
export default async function holdsRoutes(app: FastifyInstance) {
  const service = app.holds;

  app.post("/checkout-data", { schema: checkoutDataSchema }, async (request) => {
    return service.getCheckoutData(request.body as HoldCheckoutDataRequest);
  });

  app.post("/", { schema: createHoldSchema }, async (request, reply) => {
    const { hold, replayed } = await service.create(request.body as CreateHoldRequest);
    return reply.code(replayed ? 200 : 201).send(hold);
  });

  app.get("/by-shipment/:shipmentId", { schema: getHoldSchema }, async (request) => {
    const { shipmentId } = request.params as { shipmentId: string };
    const { sync } = request.query as { sync?: boolean };
    return service.getByShipment(shipmentId, { sync });
  });

  app.post("/by-shipment/:shipmentId/release", { schema: releaseHoldSchema }, async (request) => {
    const { shipmentId } = request.params as { shipmentId: string };
    return service.release(shipmentId);
  });
}
