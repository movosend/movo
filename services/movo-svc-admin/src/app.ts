import Fastify, { FastifyInstance } from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import dbPlugin from "./plugins/db";
import redisPlugin from "./plugins/redis";
import authPlugin from "./plugins/auth";

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: true });

  app.register(swagger, {
    openapi: {
      info: {
        title: "movo-svc-admin",
        version: "0.1.0",
      },
    },
  });
  app.register(swaggerUi, { routePrefix: "/docs" });

  app.register(dbPlugin);
  app.register(redisPlugin);
  app.register(authPlugin);

  app.get("/health", async () => ({ status: "ok" }));

  // Registrar rutas de módulos acá, ej:
  // app.register(usersRoutes, { prefix: "/users" });

  return app;
}
