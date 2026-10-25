import Fastify, { FastifyInstance } from "fastify";
import fastifyEnv from "@fastify/env";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import websocket from "@fastify/websocket";
import { SUPPORT_WS_PROTOCOL } from "@movo/shared";
import { envSchema } from "./config/env";
import dbPlugin from "./plugins/db";
import redisPlugin from "./plugins/redis";
import errorHandlerPlugin from "./plugins/error-handler";
import internalClientsPlugin, { InternalClientsOptions } from "./plugins/internal-clients";
import auditPlugin from "./plugins/audit";
import auditRoutes from "./modules/audit/audit.routes";
import adminsRoutes from "./modules/admins/admins.routes";
import sessionRoutes from "./modules/session/session.routes";
import usersRoutes from "./modules/users/users.routes";
import shipmentsRoutes from "./modules/shipments/shipments.routes";
import supportRoutes, { SupportRoutesOptions } from "./modules/support/support.routes";
import sanctionsRoutes from "./modules/sanctions/sanctions.routes";

export type BuildAppOptions = InternalClientsOptions & {
  /** Overrides solo para tests del WebSocket de soporte (MOVO-322): duración máxima y espera del lector. */
  supportRealtime?: Pick<SupportRoutesOptions, "maxSessionMs" | "readerBlockMs">;
};

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
  app.register(internalClientsPlugin, {
    ...(opts.usersClient ? { usersClient: opts.usersClient } : {}),
    ...(opts.shipmentsClient ? { shipmentsClient: opts.shipmentsClient } : {}),
    ...(opts.paymentsClient ? { paymentsClient: opts.paymentsClient } : {}),
    ...(opts.supportClient ? { supportClient: opts.supportClient } : {}),
  });
  app.register(auditPlugin);
  // MOVO-322: WebSocket de la bandeja de soporte. Responde solo el subprotocolo `movo-support.v1`, nunca el ticket
  // que viaja como segundo; el panel no manda nada por el canal, así que los mensajes entrantes se acotan.
  app.register(websocket, {
    options: {
      maxPayload: 1024,
      handleProtocols: (protocols: Set<string>) => (protocols.has(SUPPORT_WS_PROTOCOL) ? SUPPORT_WS_PROTOCOL : false),
    },
  });

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

  // Todo lo que expone el panel vive bajo /admin (el gateway exige el rol admin, MOVO-288).
  app.register(sessionRoutes, { prefix: "/admin" });
  app.register(auditRoutes, { prefix: "/admin" });
  app.register(adminsRoutes, { prefix: "/admin" });
  app.register(usersRoutes, { prefix: "/admin" });
  app.register(shipmentsRoutes, { prefix: "/admin" });
  app.register(supportRoutes, { prefix: "/admin", ...(opts.supportRealtime ?? {}) });
  app.register(sanctionsRoutes, { prefix: "/admin" });

  return app;
}
