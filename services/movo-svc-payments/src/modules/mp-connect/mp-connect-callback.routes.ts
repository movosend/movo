import { FastifyInstance } from "fastify";
import { CallbackQuery } from "./mp-connect.service";
import { mpConnectCallbackSchema } from "./mp-connect.schema";

/**
 * MOVO-111 AC3: `redirect_uri` de la app de MP. La llama el navegador embebido del
 * transportista al volver de Mercado Pago, sin JWT, así que vive fuera de
 * `paymentsRoutes` (y de su hook de `x-user-id`) y es pública en el gateway. A quién
 * pertenece la vinculación sale del `state`, no de un header.
 *
 * Se eligió un callback `https` + 302 al esquema custom en vez de un `redirect_uri`
 * `movo://` directo: el canje necesita el `client_secret`, así que el backend tiene que
 * estar en el medio igual, y es lo que se verificó en el spike (MOVO-49).
 */
export default async function mpConnectCallbackRoutes(app: FastifyInstance) {
  app.get<{ Querystring: CallbackQuery }>("/callback", { schema: mpConnectCallbackSchema }, async (request, reply) => {
    const location = await app.mpConnect.handleCallback(request.query);
    return reply.redirect(location, 302);
  });
}
