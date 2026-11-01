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
import mpTokenRefreshSweepPlugin from "./plugins/mp-token-refresh-sweep";
import captureRetrySweepPlugin from "./plugins/capture-retry-sweep";
import cardsPlugin from "./plugins/cards";
import transactionsPlugin from "./plugins/transactions";
import userLedgerPlugin from "./plugins/user-ledger";
import cashPaymentsPlugin from "./plugins/cash-payments";
import balancePaymentPlugin from "./plugins/balance-payment";
import paymentsRoutes from "./modules/payments/payments.routes";
import mpConnectCallbackRoutes from "./modules/mp-connect/mp-connect-callback.routes";
import holdsRoutes from "./modules/holds/holds.routes";
import cardsInternalRoutes from "./modules/cards/cards-internal.routes";
import userLedgerInternalRoutes from "./modules/user-ledger/user-ledger-internal.routes";
import cashPaymentsInternalRoutes from "./modules/cash-payments/cash-payments-internal.routes";
import mpConnectInternalRoutes from "./modules/mp-connect/mp-connect-internal.routes";
import { MercadoPagoClient, SdkMercadoPagoClient } from "./adapters/mercadopago-client";
import { FetchMercadoPagoOAuthClient, MercadoPagoOAuthClient } from "./adapters/mercadopago-oauth-client";
import { MercadoPagoCustomersClient } from "./adapters/mercadopago-customers-client";
import { UsersClient } from "./adapters/users-client";
import capturesPlugin from "./plugins/captures";
import refundsPlugin from "./plugins/refunds";
import mpWebhooksPlugin from "./plugins/mp-webhooks";
import mpWebhookRoutes from "./modules/webhooks/mp-webhook.routes";
import settlementsRoutes, { settlementIssuesRoutes } from "./modules/settlements/settlements.routes";
import refundsRoutes from "./modules/settlements/refunds.routes";
import type { ShipmentsClient } from "./adapters/shipments-client";
import shipmentsClientPlugin from "./plugins/shipments-client";
import type { AlertNotifier } from "./adapters/alert-notifier";

export interface BuildAppOptions {
  /** Override solo para tests -- evita pegarle al sandbox real de Mercado Pago,
   * mismo criterio que `diditClient` en movo-svc-users. */
  mercadoPagoClient?: MercadoPagoClient;
  /** Ídem para el canje de OAuth (MOVO-111). */
  mercadoPagoOAuthClient?: MercadoPagoOAuthClient;
  /** Override para habilitar/deshabilitar el barrido de renovación de tokens (MOVO-243). */
  mpTokenRefreshSweepEnabled?: boolean;

  /** Override para habilitar/deshabilitar el barrido de reintentos de capturas (MOVO-213). */
  captureRetrySweepEnabled?: boolean;

  /** Ídem para Customers & Cards con el token de Movo (MOVO-100). */
  mercadoPagoCustomersClient?: MercadoPagoCustomersClient;
  /** Ídem para el email del emisor, que sale de `svc-users` (MOVO-100). */
  usersClient?: UsersClient;
  /** Ídem para el aviso a svc-shipments y las alertas del webhook (MOVO-268). */
  shipmentsClient?: ShipmentsClient;
  alertNotifier?: AlertNotifier;
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
  app.register(shipmentsClientPlugin, { shipmentsClient: opts.shipmentsClient });
  app.register(authPlugin);
  app.register(errorHandlerPlugin);
  app.register(mpConnectPlugin, {
    oauthClient: opts.mercadoPagoOAuthClient ?? new FetchMercadoPagoOAuthClient(),
  });

  app.register(mpTokenRefreshSweepPlugin, {
    ...(opts.mpTokenRefreshSweepEnabled !== undefined ? { enabled: opts.mpTokenRefreshSweepEnabled } : {}),
  });

  app.decorate("mercadoPago", opts.mercadoPagoClient ?? new SdkMercadoPagoClient());
  // Después de `mercadoPago`: el service de holds lo toma de `app` (MOVO-209).
  app.register(holdsPlugin);
  // MOVO-100: tarjetas guardadas del emisor. Necesita env, DB y Redis.
  app.register(cardsPlugin, {
    customersClient: opts.mercadoPagoCustomersClient,
    usersClient: opts.usersClient,
  });
  // MOVO-303: historial de transacciones (lectura de holds, liquidaciones y eventos).
  app.register(transactionsPlugin);
  // MOVO-309 (DD-044): cuenta corriente del usuario. Solo necesita la DB.
  app.register(userLedgerPlugin);
  app.register(cashPaymentsPlugin);
  // MOVO-212: captura del hold y liquidación, también sobre `mercadoPago`.
  app.register(capturesPlugin);
  // MOVO-336: reembolso de un pago ya capturado (resolución de disputas, MOVO-337).
  app.register(refundsPlugin);
  // MOVO-213: reintenta las capturas fallidas con backoff y escala las que no se arreglan solas.
  app.register(captureRetrySweepPlugin, {
    ...(opts.captureRetrySweepEnabled !== undefined ? { enabled: opts.captureRetrySweepEnabled } : {}),
  });
  // Después de `holds`: reconcilia intentos en `creating` con su service (MOVO-268).
  app.register(mpWebhooksPlugin, { alertNotifier: opts.alertNotifier });
  // MOVO-312: "Pagar mi saldo". Después de `mpWebhooks` (usa `app.alerts`) y de `userLedger`.
  app.register(balancePaymentPlugin);

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

  // MOVO-268: webhook de MP. Público en el gateway, protegido por la firma `x-signature`;
  // fuera de `paymentsRoutes` por el mismo motivo que el callback de OAuth.
  app.register(mpWebhookRoutes, { prefix: "/payments/webhooks" });

  // MOVO-209: interno, lo llama svc-shipments. Sin ruta en el gateway (ADR-010).
  app.register(holdsRoutes, { prefix: "/internal/payments/holds" });
  // MOVO-212: captura (`/by-shipment/:id/capture`) y liquidación (`/by-shipment/:id/settlement`).
  app.register(settlementsRoutes, { prefix: "/internal/payments/holds" });
  // MOVO-213: liquidaciones pendientes de reintento o escaladas (proceso manual).
  app.register(settlementIssuesRoutes, { prefix: "/internal/payments/settlements" });
  // MOVO-336: reembolso (`/by-shipment/:id/refund`) y sus intentos (`/refunds`); mismo prefijo que las liquidaciones.
  app.register(refundsRoutes, { prefix: "/internal/payments/settlements" });

  // MOVO-100: interno, lo llama svc-users al dar de baja una cuenta (MOVO-39).
  app.register(cardsInternalRoutes, { prefix: "/internal/payments/users" });
  // MOVO-309: cuenta corriente (saldo, alta de movimientos, ajuste manual), interno.
  app.register(userLedgerInternalRoutes, { prefix: "/internal/payments/users" });
  // MOVO-37: comisión y penalidad de los envíos pagados en efectivo, interno.
  app.register(cashPaymentsInternalRoutes, { prefix: "/internal/payments/cash-shipments" });

  // MOVO-116: interno, lo llama svc-shipments para el bloqueo del transportista.
  app.register(mpConnectInternalRoutes, { prefix: "/internal/payments/mp-connect" });

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    mercadoPago: MercadoPagoClient;
  }
}
