import { FastifyInstance, FastifyPluginOptions, FastifyRequest } from "fastify";
import { requireAdmin } from "../../utils/require-admin";
import { sessionSchemas } from "./session.schema";

/** MOVO-291: el BFF del panel confirma con esto que la sesión sigue autorizada en el gateway. */
export default async function sessionRoutes(app: FastifyInstance, _opts: FastifyPluginOptions) {
  app.get(
    "/session",
    {
      schema: {
        tags: ["admin"],
        summary: "Validar acceso del panel",
        response: { 200: sessionSchemas.response },
      },
    },
    async (request: FastifyRequest, reply) => {
      requireAdmin(request);
      reply.header("Cache-Control", "no-store");
      return { authenticated: true };
    },
  );
}
