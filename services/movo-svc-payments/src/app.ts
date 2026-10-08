import Fastify, { FastifyInstance } from "fastify";
import fastifyEnv from "@fastify/env";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { envSchema } from "./config/env";
import { loggerOptions } from "./config/logger";
import dbPlugin from "./plugins/db";
import redisPlugin from "./plugins/redis";
import authPlugin from "./plugins/auth";
import paymentsRoutes from "./modules/payments/payments.routes";
import { MercadoPagoClient, SdkMercadoPagoClient } from "./adapters/mercadopago-client";

export interface BuildAppOptions {
  /** Override solo para tests -- evita pegarle al sandbox real de Mercado Pago,
   * mismo criterio que `diditClient` en movo-svc-users. */
  mercadoPagoClient?: MercadoPagoClient;
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

  app.decorate("mercadoPago", opts.mercadoPagoClient ?? new SdkMercadoPagoClient());

  app.get("/health", async () => ({ status: "ok" }));

  app.register(paymentsRoutes, { prefix: "/payments" });

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    mercadoPago: MercadoPagoClient;
  }
}
