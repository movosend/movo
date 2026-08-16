import Fastify, { FastifyInstance } from "fastify";
import fastifyEnv from "@fastify/env";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { envSchema } from "./config/env";
import dbPlugin from "./plugins/db";
import redisPlugin from "./plugins/redis";
import authPlugin from "./plugins/auth";
import errorHandlerPlugin from "./plugins/error-handler";
import shipmentsRoutes, { ShipmentsRoutesOptions } from "./modules/shipments/shipments.routes";
import { UsersClient } from "./adapters/users-client";
import { StorageProvider } from "./adapters/storage-provider";

export interface BuildAppOptions {
  /** Override solo para tests de integración — evita depender de un `movo-svc-users`
   * real levantado, mismo criterio que `smsProvider`/`diditClient`/`geocodingProvider`/
   * `storageProvider` en movo-svc-users. */
  usersClient?: UsersClient;
  /** Override solo para tests de integración — evita depender de un bucket real/
   * credenciales de AWS (MOVO-81). */
  storageProvider?: StorageProvider;
}

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
        title: "movo-svc-shipments",
        version: "0.1.0",
      },
    },
  });
  app.register(swaggerUi, { routePrefix: "/docs" });

  app.register(errorHandlerPlugin);
  app.register(dbPlugin);
  app.register(redisPlugin);
  app.register(authPlugin);

  app.get("/health", async () => ({ status: "ok" }));

  const shipmentsRouteOpts: ShipmentsRoutesOptions = {
    prefix: "/shipments",
    ...(opts.usersClient ? { usersClient: opts.usersClient } : {}),
    ...(opts.storageProvider ? { storageProvider: opts.storageProvider } : {}),
  };
  app.register(shipmentsRoutes, shipmentsRouteOpts);

  return app;
}
