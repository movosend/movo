import Fastify, { FastifyInstance } from "fastify";
import { ApiError } from "@movo/shared";
import fastifyEnv from "@fastify/env";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { envSchema } from "./config/env";
import dbPlugin from "./plugins/db";
import redisPlugin from "./plugins/redis";
import authPlugin from "./plugins/auth";
import errorHandlerPlugin from "./plugins/error-handler";
import receiverConfirmationSweepPlugin from "./plugins/receiver-confirmation-sweep";
import orphanPhotoSweepPlugin from "./plugins/orphan-photo-sweep";
import pickupExpirySweepPlugin from "./plugins/pickup-expiry-sweep";
import shipmentsRoutes, { ShipmentsRoutesOptions } from "./modules/shipments/shipments.routes";
import offersRoutes, { OffersRoutesOptions } from "./modules/offers/offers.routes";
import ratingsRoutes, { internalRatingsRoutes, RatingsRoutesOptions } from "./modules/ratings/ratings.routes";
import tripsRoutes, { TripsRoutesOptions } from "./modules/trips/trips.routes";
import accountDeletionRoutes from "./modules/account-deletion/account-deletion.routes";
import { UsersClient } from "./adapters/users-client";
import { StorageProvider } from "./adapters/storage-provider";
import { RoutesProvider } from "./adapters/routes-provider";
import { NotificationsClient } from "./adapters/notifications-client";
import { PricingClient } from "./adapters/pricing-client";

export interface BuildAppOptions {
  /** Override solo para tests de integración — evita depender de un `movo-svc-users`
   * real levantado, mismo criterio que `smsProvider`/`diditClient`/`geocodingProvider`/
   * `storageProvider` en movo-svc-users. */
  usersClient?: UsersClient;
  /** Override solo para tests de integración — evita depender de un bucket real/
   * credenciales de AWS (MOVO-81). */
  storageProvider?: StorageProvider;
  /** Override solo para tests de integración — evita depender de credenciales reales
   * de Google (MOVO-123), mismo criterio que `usersClient`. */
  routesProvider?: RoutesProvider;
  /** Override solo para tests de integración — evita depender de un `movo-svc-users`
   * real levantado (MOVO-108/129), mismo criterio que `usersClient`. */
  notificationsClient?: NotificationsClient;
  /** Override solo para tests de integración — evita depender de un
   * `movo-svc-pricing-logistics` real levantado (MOVO-82), mismo criterio que
   * `usersClient`. */
  pricingClient?: PricingClient;
  /** Override para habilitar/deshabilitar el barrido periódico en background (MOVO-130). */
  sweepEnabled?: boolean;
  /** Override para habilitar/deshabilitar el sweep de fotos huérfanas en background (MOVO-124). */
  orphanPhotoSweepEnabled?: boolean;
  /** Override para habilitar/deshabilitar el sweep de retiro vencido en background. */
  pickupExpirySweepEnabled?: boolean;
}

export function buildApp(opts: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: true });

  // MOVO-129: un body vacío con `content-type: application/json` (lo que manda cualquier
  // cliente HTTP que setee el header incondicionalmente) hace fallar al parser por defecto
  // con FST_ERR_CTP_EMPTY_JSON_BODY -- un 400 antes de llegar a la validación de schema.
  // Los endpoints de decisión del receptor se documentan como "body vacío", así que acá lo
  // tratamos como `null` y dejamos que el schema (`nullable: true`) decida.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body: string, done) => {
      if (body === "") {
        done(null, null);
        return;
      }
      try {
        done(null, JSON.parse(body));
      } catch {
        // `ApiError` y no un Error suelto: el error handler solo mapea al formato único
        // los `ApiError` y los de validación de AJV -- cualquier otro cae al 500 genérico.
        done(new ApiError(400, "VALIDATION_FAILED", "El body no es JSON válido."), undefined);
      }
    }
  );

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
  app.register(receiverConfirmationSweepPlugin, {
    ...(opts.usersClient ? { usersClient: opts.usersClient } : {}),
    ...(opts.notificationsClient ? { notificationsClient: opts.notificationsClient } : {}),
    ...(opts.sweepEnabled !== undefined ? { enabled: opts.sweepEnabled } : {}),
  });
  app.register(orphanPhotoSweepPlugin, {
    ...(opts.storageProvider ? { storageProvider: opts.storageProvider } : {}),
    ...(opts.orphanPhotoSweepEnabled !== undefined ? { enabled: opts.orphanPhotoSweepEnabled } : {}),
  });
  app.register(pickupExpirySweepPlugin, {
    ...(opts.usersClient ? { usersClient: opts.usersClient } : {}),
    ...(opts.notificationsClient ? { notificationsClient: opts.notificationsClient } : {}),
    ...(opts.pickupExpirySweepEnabled !== undefined ? { enabled: opts.pickupExpirySweepEnabled } : {}),
  });

  app.get("/health", async () => ({ status: "ok" }));

  const shipmentsRouteOpts: ShipmentsRoutesOptions = {
    prefix: "/shipments",
    ...(opts.usersClient ? { usersClient: opts.usersClient } : {}),
    ...(opts.storageProvider ? { storageProvider: opts.storageProvider } : {}),
    ...(opts.routesProvider ? { routesProvider: opts.routesProvider } : {}),
    ...(opts.notificationsClient ? { notificationsClient: opts.notificationsClient } : {}),
    ...(opts.pricingClient ? { pricingClient: opts.pricingClient } : {}),
  };
  app.register(shipmentsRoutes, shipmentsRouteOpts);

  // MOVO-144/145: prefijo propio, no anidado bajo /shipments, mismo criterio que
  // /addresses en el gateway.
  const offersRouteOpts: OffersRoutesOptions = {
    prefix: "/offers",
    ...(opts.notificationsClient ? { notificationsClient: opts.notificationsClient } : {}),
  };
  app.register(offersRoutes, offersRouteOpts);

  // MOVO-146: montado con el mismo prefix "/shipments" que shipmentsRoutes -- rutas
  // "/shipments/:id/ratings"/"/shipments/:id/ratings/:rateeId", dominio propio (tabla
  // ratings) por eso vive en su propio módulo.
  const ratingsRouteOpts: RatingsRoutesOptions = {
    prefix: "/shipments",
    ...(opts.notificationsClient ? { notificationsClient: opts.notificationsClient } : {}),
  };
  app.register(ratingsRoutes, ratingsRouteOpts);

  // MOVO-161: viajes declarados por el transportista para matching geométrico de paquetes
  // compatibles por corredor ("Mis viajes", MOVO-18/162).
  const tripsRouteOpts: TripsRoutesOptions = {
    prefix: "/trips",
    ...(opts.usersClient ? { usersClient: opts.usersClient } : {}),
  };
  app.register(tripsRoutes, tripsRouteOpts);

  // MOVO-134: consultado por movo-svc-users antes de aplicar una baja de cuenta.
  // Interno -- no se declara en gateway/src/config/routes-map.ts (mismo criterio que
  // /internal/notifications de movo-svc-users, MOVO-106).
  app.register(accountDeletionRoutes, { prefix: "/internal/account-deletion" });

  // MOVO-146 AC10: consultado por movo-svc-users para el agregado/últimas
  // calificaciones del perfil (MOVO-25). Interno, mismo criterio que accountDeletionRoutes.
  app.register(internalRatingsRoutes, { prefix: "/internal" });

  return app;
}
