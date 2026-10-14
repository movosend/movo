import { FastifyInstance, FastifyRequest } from "fastify";
import { CreateSavedCardRequest, UpdateSavedCardRequest } from "@movo/shared";
import {
  cardsCheckoutDataSchema,
  createCardSchema,
  deleteCardSchema,
  listCardsSchema,
  setDefaultCardSchema,
  updateCardSchema,
} from "./cards.schema";

/** El hook de `paymentsRoutes` ya validó que `x-user-id` existe y es un UUID. */
function userIdOf(request: FastifyRequest): string {
  const raw = request.headers["x-user-id"];
  return (Array.isArray(raw) ? raw[0] : raw) as string;
}

/**
 * MOVO-100: tarjetas guardadas del emisor. Se registran dentro de `paymentsRoutes` para
 * heredar su hook de `x-user-id`; cada operación se filtra por ese usuario, así una tarjeta
 * ajena responde 404 (no 403: no se confirma que exista).
 */
export default async function cardsRoutes(app: FastifyInstance) {
  const service = app.cards;

  app.get("/checkout-data", { schema: cardsCheckoutDataSchema }, async () => service.getCheckoutData());

  app.post("/", { schema: createCardSchema }, async (request, reply) => {
    const { card, created } = await service.create(userIdOf(request), request.body as CreateSavedCardRequest);
    return reply.code(created ? 201 : 200).send(card);
  });

  app.get("/", { schema: listCardsSchema }, async (request) => service.list(userIdOf(request)));

  app.patch("/:id/default", { schema: setDefaultCardSchema }, async (request) => {
    const { id } = request.params as { id: string };
    return service.setDefault(userIdOf(request), id);
  });

  app.patch("/:id", { schema: updateCardSchema }, async (request) => {
    const { id } = request.params as { id: string };
    const { alias } = request.body as UpdateSavedCardRequest;
    return service.updateAlias(userIdOf(request), id, alias);
  });

  app.delete("/:id", { schema: deleteCardSchema }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await service.remove(userIdOf(request), id);
    return reply.code(204).send();
  });
}
