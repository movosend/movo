import Fastify, { FastifyInstance } from "fastify";
import fastifyEnv from "@fastify/env";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { envSchema } from "./config/env";
import dbPlugin from "./plugins/db";
import redisPlugin from "./plugins/redis";
import errorHandlerPlugin from "./plugins/error-handler";

export function buildApp(): FastifyInstance {
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

  app.get("/health", async () => ({ status: "ok" }));

  return app;
}
