import { FastifyInstance, FastifyRequest } from "fastify";
import { mpConnectAuthorizationUrlSchema, mpConnectStatusSchema, mpConnectUnlinkSchema } from "./mp-connect.schema";

/** El hook de `paymentsRoutes` ya validó que `x-user-id` existe y es un UUID. */
function userIdOf(request: FastifyRequest): string {
  const raw = request.headers["x-user-id"];
  return (Array.isArray(raw) ? raw[0] : raw) as string;
}

/**
 * MOVO-111: rutas protegidas de la vinculación. Se registran dentro de `paymentsRoutes`
 * para heredar su hook de `x-user-id`. No se chequea el rol `carrier` aparte: el gateway
 * ya exige sender o carrier, y toda cuenta nace con los dos roles (`DEFAULT_USER_ROLES`
 * en movo-svc-users).
 */
export default async function mpConnectRoutes(app: FastifyInstance) {
  const service = app.mpConnect;

  app.get("/status", { schema: mpConnectStatusSchema }, async (request) => {
    return service.getStatus(userIdOf(request));
  });

  app.get("/authorization-url", { schema: mpConnectAuthorizationUrlSchema }, async (request) => {
    return service.buildAuthorizationUrl(userIdOf(request));
  });

  app.delete("/", { schema: mpConnectUnlinkSchema }, async (request, reply) => {
    await service.unlink(userIdOf(request));
    return reply.code(204).send();
  });
}
