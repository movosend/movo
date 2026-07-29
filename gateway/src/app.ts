import Fastify, { FastifyInstance } from "fastify";
import helmet from "@fastify/helmet";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { loadEnv } from "./config/env";
import { API_PREFIX } from "./config/routes-map";
import errorHandlerPlugin from "./plugins/error-handler";
import rateLimitPlugin from "./plugins/rate-limit";
import authPlugin from "./plugins/auth";
import routesPlugin from "./routes/index";

export function buildApp(): FastifyInstance {
  const env = loadEnv();

  // trustProxy: el gateway solo recibe tráfico del contenedor nginx
  // (ver infra/docker-compose.yml), así que confiamos en su X-Forwarded-For
  // para que el rate limit y los logs vean la IP real del cliente.
  const app = Fastify({ logger: true, trustProxy: true });

  app.register(errorHandlerPlugin);

  // hsts: false porque ese header ya lo pone nginx (infra/nginx/templates),
  // que es la capa que efectivamente termina TLS. Evita mandar el mismo
  // header duplicado con dos max-age distintos.
  app.register(helmet, { hsts: false });
  app.register(rateLimitPlugin, { env });

  app.register(swagger, {
    openapi: {
      info: {
        title: "movo-gateway",
        version: "0.1.0",
      },
    },
  });
  app.register(swaggerUi, { routePrefix: "/docs" });

  app.register(authPlugin, { env });
  app.register(routesPlugin, { env, prefix: API_PREFIX });

  // Fuera de /api/v1 a propósito: es el endpoint que consultan el healthcheck
  // de Docker y el load balancer, conviene que sea estable y no versionado.
  app.get("/health", async () => ({ status: "ok" }));

  return app;
}
