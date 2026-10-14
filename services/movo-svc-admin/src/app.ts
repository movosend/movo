import Fastify, { FastifyInstance } from "fastify";
import fastifyEnv from "@fastify/env";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { envSchema } from "./config/env";
import dbPlugin from "./plugins/db";
import redisPlugin from "./plugins/redis";
import errorHandlerPlugin from "./plugins/error-handler";
import internalClientsPlugin, { InternalClientsOptions } from "./plugins/internal-clients";

export type BuildAppOptions = InternalClientsOptions;

export function buildApp(opts: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: true });

  app.register(fastifyEnv, {
    schema: envSchema,
    dotenv: true,
    data: process.env,
  });

  app.register(swagger, {
    openapi: {
      info: {
        title: "movo-svc-admin",
        version: "0.1.0",
      },
    },
  });
  app.register(swaggerUi, { routePrefix: "/docs" });

  // Sin plugin de auth: la identidad llega en `x-user-*` desde el gateway (ADR-010).
  app.register(dbPlugin);
  app.register(redisPlugin);
  app.register(errorHandlerPlugin);
  // Después de @fastify/env: los clientes toman las URLs de `app.config`.
  app.register(internalClientsPlugin, opts);

  // Mismo criterio que el resto de los servicios Prisma: el healthcheck de Docker refleja
  // si el servicio puede hablar con Postgres, sin exponer el detalle del error.
  app.get("/health", async (_request, reply) => {
    const postgres = await app.checkDbHealth();
    if (postgres.status === "error") {
      app.log.error({ postgresError: postgres.error }, "Healthcheck con Postgres caído");
      return reply.code(503).send({ status: "error", checks: { postgres: { status: "error" } } });
    }
    return { status: "ok", checks: { postgres: { status: "ok" } } };
  });

  return app;
}
