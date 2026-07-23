import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import httpProxy from "@fastify/http-proxy";
import { EnvConfig } from "../config/env";

// Reglas de ruteo del gateway: cada prefijo público se reenvía a su
// microservicio interno (nunca expuesto directamente afuera). /users
// queda público porque ahí viven login/registro; el resto requiere JWT
// válido, verificado acá antes de reenviar la request.
export default fp(async (app: FastifyInstance, opts: { env: EnvConfig }) => {
  const { env } = opts;

  await app.register(httpProxy, {
    upstream: env.USERS_SERVICE_URL,
    prefix: "/users",
    rewritePrefix: "/",
  });

  await app.register(httpProxy, {
    upstream: env.SHIPMENTS_SERVICE_URL,
    prefix: "/shipments",
    rewritePrefix: "/",
    preHandler: app.authenticate,
  });

  await app.register(httpProxy, {
    upstream: env.PAYMENTS_SERVICE_URL,
    prefix: "/payments",
    rewritePrefix: "/",
    preHandler: app.authenticate,
  });

  await app.register(httpProxy, {
    upstream: env.ADMIN_SERVICE_URL,
    prefix: "/admin",
    rewritePrefix: "/",
    preHandler: app.authenticate,
  });
});
