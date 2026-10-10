import Fastify, { FastifyInstance } from "fastify";
import fastifyEnv from "@fastify/env";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { envSchema } from "./config/env";
import { loggerOptions } from "./config/logger";
import dbPlugin from "./plugins/db";
import redisPlugin from "./plugins/redis";
import authPlugin from "./plugins/auth";
import errorHandlerPlugin from "./plugins/error-handler";
import mpConnectPlugin from "./plugins/mp-connect";
import holdsPlugin from "./plugins/holds";
import paymentsRoutes from "./modules/payments/payments.routes";
import mpConnectCallbackRoutes from "./modules/mp-connect/mp-connect-callback.routes";
import holdsRoutes from "./modules/holds/holds.routes";
import { MercadoPagoClient, SdkMercadoPagoClient } from "./adapters/mercadopago-client";
import { FetchMercadoPagoOAuthClient, MercadoPagoOAuthClient } from "./adapters/mercadopago-oauth-client";

export interface BuildAppOptions {
  /** Override solo para tests -- evita pegarle al sandbox real de Mercado Pago,
   * mismo criterio que `diditClient` en movo-svc-users. */
  mercadoPagoClient?: MercadoPagoClient;
  /** Ídem para el canje de OAuth (MOVO-111). */
  mercadoPagoOAuthClient?: MercadoPagoOAuthClient;
}

export function buildApp(opts: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: loggerOptions });

  app.register(fastifyEnv, {
    schema: envSchema,
    dotenv: true,
    data: process.env,
  });

  app.register(swagger, {
    openapi: {
      info: {
        title: "movo-svc-payments",
        version: "0.1.0",
      },
    },
  });
  app.register(swaggerUi, { routePrefix: "/docs" });

  app.register(dbPlugin);
  app.register(redisPlugin);
  app.register(authPlugin);
  app.register(errorHandlerPlugin);
  app.register(mpConnectPlugin, {
    oauthClient: opts.mercadoPagoOAuthClient ?? new FetchMercadoPagoOAuthClient(),
  });

  app.decorate("mercadoPago", opts.mercadoPagoClient ?? new SdkMercadoPagoClient());
  // Después de `mercadoPago`: el service de holds lo toma de `app` (MOVO-209).
  app.register(holdsPlugin);

  // Mismo criterio que movo-svc-users: el healthcheck de Docker tiene que reflejar
  // si el servicio puede hablar con Postgres. El detalle del error se loguea y no
  // viaja en la respuesta (puede incluir host/usuario de la conexión).
  app.get("/health", async (_request, reply) => {
    const postgres = await app.checkDbHealth();
    if (postgres.status === "error") {
      app.log.error({ postgresError: postgres.error }, "Healthcheck con Postgres caído");
      return reply.code(503).send({ status: "error", checks: { postgres: { status: "error" } } });
    }
    return { status: "ok", checks: { postgres: { status: "ok" } } };
  });

  app.register(paymentsRoutes, { prefix: "/payments" });
  // Fuera de `paymentsRoutes` a propósito: lo llama el navegador al volver de MP, sin
  // `x-user-id` (ruta pública en el gateway, MOVO-111).
  app.register(mpConnectCallbackRoutes, { prefix: "/payments/mp-connect" });

  // MOVO-209: interno, lo llama svc-shipments. Sin ruta en el gateway (ADR-010).
  app.register(holdsRoutes, { prefix: "/internal/payments/holds" });

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    mercadoPago: MercadoPagoClient;
  }
}
