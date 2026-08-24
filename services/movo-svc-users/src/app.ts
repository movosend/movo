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
import usersRoutes, { UsersRoutesOptions } from "./modules/users/users.routes";
import authRoutes, { AuthRoutesOptions } from "./modules/auth/auth.routes";
import kycRoutes, { KycRoutesOptions } from "./modules/kyc/kyc.routes";
import geocodeRoutes, {
  GeocodeRoutesOptions,
} from "./modules/geocode/geocode.routes";
import placesRoutes, {
  PlacesRoutesOptions,
} from "./modules/places/places.routes";
import notificationsRoutes, {
  NotificationsRoutesOptions,
} from "./modules/notifications/notifications.routes";
import addressesRoutes from "./modules/addresses/addresses.routes";
import orphanPhotoSweepPlugin from "./plugins/orphan-photo-sweep";
import { SmsProvider } from "./adapters/sms-provider";
import { EmailProvider } from "./adapters/email-provider";
import { DiditClient } from "./adapters/didit-client";
import { GeocodingProvider } from "./adapters/geocoding-provider";
import { PlacesProvider } from "./adapters/places-provider";
import { StorageProvider } from "./adapters/storage-provider";
import { PushNotificationProvider } from "./adapters/push-notification-provider";
import { ShipmentsClient } from "./adapters/shipments-client";

export interface BuildAppOptions {
  /** Override solo para tests de integración — permite capturar el código de OTP
   * generado, ya que nunca sale por HTTP (DoD de MOVO-71). */
  smsProvider?: SmsProvider;
  /** Override solo para tests de integración — evita depender de red/credenciales
   * reales de Didit.me (MOVO-72), mismo criterio que `smsProvider`. */
  diditClient?: DiditClient;
  /** Override solo para tests de integración — evita depender de red/credenciales
   * reales de Google Maps (MOVO-73), mismo criterio que `diditClient`. */
  geocodingProvider?: GeocodingProvider;
  /** Override solo para tests de integración — evita depender de red/credenciales
   * reales de Google Maps (MOVO-83), mismo criterio que `geocodingProvider`. */
  placesProvider?: PlacesProvider;
  /** Override solo para tests de integración — evita depender de un bucket real/
   * credenciales de AWS (MOVO-97), mismo criterio que `geocodingProvider`. */
  storageProvider?: StorageProvider;
  /** Override solo para tests de integración — evita depender de red (MOVO-106),
   * mismo criterio que `storageProvider`. */
  pushProvider?: PushNotificationProvider;
  /** Override solo para tests de integración — evita depender de un `movo-svc-shipments`
   * real levantado (MOVO-134), mismo criterio que `storageProvider`. */
  shipmentsClient?: ShipmentsClient;
  /** Override solo para tests de integración — evita depender de la API de Resend
   * (MOVO-139/ADR-017), mismo criterio que `smsProvider`. */
  emailProvider?: EmailProvider;
  /** Override para habilitar/deshabilitar el sweep de fotos huérfanas en background (MOVO-124). */
  orphanPhotoSweepEnabled?: boolean;
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
  app.register(orphanPhotoSweepPlugin, {
    ...(opts.storageProvider ? { storageProvider: opts.storageProvider } : {}),
    ...(opts.orphanPhotoSweepEnabled !== undefined ? { enabled: opts.orphanPhotoSweepEnabled } : {}),
  });

  // Fuera de /api/v1 a propósito: lo consultan el healthcheck de Docker y el
  // load balancer, conviene que sea estable y no versionado.
  app.register(healthRoutes);

  const usersRouteOpts: UsersRoutesOptions = {
    prefix: "/users",
    ...(opts.storageProvider ? { storageProvider: opts.storageProvider } : {}),
    ...(opts.shipmentsClient ? { shipmentsClient: opts.shipmentsClient } : {}),
    // MOVO-133: cambio de teléfono/email reusa el motor de OTP -- mismo override que
    // ya usa authRouteOpts para tests de integración.
    ...(opts.smsProvider ? { smsProvider: opts.smsProvider } : {}),
    // MOVO-139: el OTP de verificación/cambio de email y el aviso al email anterior.
    ...(opts.emailProvider ? { emailProvider: opts.emailProvider } : {}),
  };
  app.register(usersRoutes, usersRouteOpts);

  // `exactOptionalPropertyTypes` no deja escribir `smsProvider: undefined` explícito
  // en el literal — se arma condicionalmente para que la clave falte del todo cuando
  // no hay override (producción usa el SmsProvider real armado en auth.routes.ts).
  const authRouteOpts: AuthRoutesOptions = {
    prefix: "/auth",
    ...(opts.smsProvider ? { smsProvider: opts.smsProvider } : {}),
    ...(opts.emailProvider ? { emailProvider: opts.emailProvider } : {}),
  };
  app.register(authRoutes, authRouteOpts);

  const kycRouteOpts: KycRoutesOptions = {
    prefix: "/kyc",
    ...(opts.diditClient ? { diditClient: opts.diditClient } : {}),
  };
  app.register(kycRoutes, kycRouteOpts);

  const geocodeRouteOpts: GeocodeRoutesOptions = {
    prefix: "/geocode",
    ...(opts.geocodingProvider
      ? { geocodingProvider: opts.geocodingProvider }
      : {}),
  };
  app.register(geocodeRoutes, geocodeRouteOpts);

  const placesRouteOpts: PlacesRoutesOptions = {
    prefix: "/places",
    ...(opts.placesProvider ? { placesProvider: opts.placesProvider } : {}),
  };
  app.register(placesRoutes, placesRouteOpts);

  // Interno (AC6/AC7 de MOVO-106): no se declara `/internal` en
  // `gateway/src/config/routes-map.ts`, así que el gateway no lo proxea — solo
  // alcanzable dentro de la red Docker por otros servicios.
  const notificationsRouteOpts: NotificationsRoutesOptions = {
    prefix: "/internal/notifications",
    ...(opts.pushProvider ? { pushProvider: opts.pushProvider } : {}),
  };
  app.register(notificationsRoutes, notificationsRouteOpts);

  // MOVO-119: prefijo propio (no anidado bajo /users), mismo criterio que /kyc y
  // /geocode -- recurso con identidad propia aunque comparta este mismo servicio.
  app.register(addressesRoutes, { prefix: "/addresses" });

  return app;
}
