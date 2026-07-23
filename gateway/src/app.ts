import Fastify, { FastifyInstance } from "fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { loadEnv } from "./config/env";
import authPlugin from "./plugins/auth";
import proxyPlugin from "./plugins/proxy";

export function buildApp(): FastifyInstance {
  const env = loadEnv();

  // trustProxy: el gateway solo recibe tráfico del contenedor nginx
  // (ver infra/docker-compose.yml), así que confiamos en su X-Forwarded-For
  // para que el rate limit y los logs vean la IP real del cliente.
  const app = Fastify({ logger: true, trustProxy: true });

  // hsts: false porque ese header ya lo pone nginx (infra/nginx/templates),
  // que es la capa que efectivamente termina TLS. Evita mandar el mismo
  // header duplicado con dos max-age distintos.
  app.register(helmet, { hsts: false });
  app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: "1 minute",
  });

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
  app.register(proxyPlugin, { env });

  app.get("/health", async () => ({ status: "ok" }));

  return app;
}
