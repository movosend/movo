import Fastify, { FastifyInstance } from "fastify";
import fastifyEnv from "@fastify/env";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { envSchema } from "./config/env";
import dbPlugin from "./plugins/db";
import redisPlugin from "./plugins/redis";
import authPlugin from "./plugins/auth";
import errorHandlerPlugin from "./plugins/error-handler";
import healthRoutes from "./modules/health/health.routes";
import usersRoutes from "./modules/users/users.routes";
import authRoutes from "./modules/auth/auth.routes";

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
        title: "movo-svc-users",
        version: "0.1.0",
      },
    },
  });
  app.register(swaggerUi, { routePrefix: "/docs" });

  app.register(errorHandlerPlugin);
  app.register(dbPlugin);
  app.register(redisPlugin);
  app.register(authPlugin);

  // Fuera de /api/v1 a propósito: lo consultan el healthcheck de Docker y el
  // load balancer, conviene que sea estable y no versionado.
  app.register(healthRoutes);

  app.register(usersRoutes, { prefix: "/users" });
  app.register(authRoutes, { prefix: "/auth" });

  return app;
}
