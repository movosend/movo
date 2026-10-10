import { FastifyInstance, FastifyPluginOptions, FastifyRequest } from "fastify";
import { HoldProviderEventRequest, ShipmentFundingRequest } from "@movo/shared";
import { createNotificationsClient, NotificationsClient } from "../../adapters/notifications-client";
import { createPaymentsClient, PaymentsClient } from "../../adapters/payments-client";
import { createUsersClient, UsersClient } from "../../adapters/users-client";
import { createShipmentRepository } from "../../repositories/shipment-repository";
import { requireUserIdFromHeader } from "../../utils/require-user-id";
import { fundingSchemas } from "./funding.schema";
import { createFundingService, FundingService } from "./funding.service";

export interface FundingRoutesOptions extends FastifyPluginOptions {
  /** Overrides solo para tests de integración -- mismo criterio que el resto de los módulos. */
  usersClient?: UsersClient;
  notificationsClient?: NotificationsClient;
  paymentsClient?: PaymentsClient;
}

/** Arma el service de la saga con la config de env; lo comparten las rutas y el barrido. */
export function buildFundingService(
  app: FastifyInstance,
  opts: FundingRoutesOptions & {
    claimNotificationOnce?: (key: string, ttlSeconds: number) => Promise<boolean>;
    releaseNotificationClaim?: (key: string) => Promise<void>;
  } = {},
): FundingService {
  return createFundingService({
    repository: createShipmentRepository(app.db),
    usersClient: opts.usersClient ?? createUsersClient(app.config),
    paymentsClient: opts.paymentsClient ?? createPaymentsClient(app.config),
    notificationsClient: opts.notificationsClient ?? createNotificationsClient(app.config),
    logger: app.log,
    claimNotificationOnce: opts.claimNotificationOnce,
    releaseNotificationClaim: opts.releaseNotificationClaim,
    config: {
      nearPickupDays: app.config.FUNDING_NEAR_PICKUP_DAYS,
      paymentTimeoutMinutes: app.config.FUNDING_PAYMENT_TIMEOUT_MINUTES,
      releaseHoursBeforePickup: app.config.FUNDING_RELEASE_HOURS_BEFORE_PICKUP,
      reminderIntervalHours: app.config.FUNDING_REMINDER_INTERVAL_HOURS,
    },
  });
}

/**
 * MOVO-210 (AC1/AC2): endpoints de pago del envío que consume el mobile (MOVO-269).
 * Montado bajo `/shipments`: `GET`/`POST /shipments/:id/funding`. Solo el emisor.
 */
export default async function fundingRoutes(app: FastifyInstance, opts: FundingRoutesOptions) {
  const service = buildFundingService(app, opts);

  app.get(
    "/:id/funding",
    {
      schema: {
        summary: "Datos para pagar el envío (emisor)",
        description:
          "MOVO-210 AC1: `public_key` del transportista asignado (con la que el mobile tokeniza " +
          "la tarjeta), monto acordado y hasta cuándo puede pagar el emisor. Solo responde con " +
          "el envío en `assignment_pending` o en `assigned_unfunded` con la ventana de " +
          "confirmación abierta (409 SHIPMENT_FUNDING_NOT_AVAILABLE en cualquier otro caso).",
        tags: ["funding"],
        params: fundingSchemas.shipmentIdParam,
        response: {
          200: fundingSchemas.fundingResponse,
          401: fundingSchemas.errorResponse,
          403: fundingSchemas.errorResponse,
          404: fundingSchemas.errorResponse,
          409: fundingSchemas.errorResponse,
          502: fundingSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      const callerId = requireUserIdFromHeader(request);
      const { id } = request.params as { id: string };
      return service.getFunding(id, callerId);
    },
  );

  app.post(
    "/:id/funding",
    {
      schema: {
        summary: "Pagar el envío: reservar los fondos (emisor)",
        description:
          "MOVO-210 AC2/AC14: crea la reserva (hold) con el `cardToken` generado con la " +
          "`public_key` del transportista y, si MP la autoriza, pasa el envío a `assigned`. " +
          "Idempotente: repetir la llamada sobre un envío ya pagado responde `funded: true`. " +
          "Un rechazo de la tarjeta NO es un error HTTP: 200 con `funded: false` y " +
          "`failureReason`, sin cambiar el estado del envío.",
        tags: ["funding"],
        params: fundingSchemas.shipmentIdParam,
        body: fundingSchemas.fundingBody,
        response: {
          200: fundingSchemas.fundingResult,
          400: fundingSchemas.errorResponse,
          401: fundingSchemas.errorResponse,
          403: fundingSchemas.errorResponse,
          404: fundingSchemas.errorResponse,
          409: fundingSchemas.errorResponse,
          502: fundingSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      const callerId = requireUserIdFromHeader(request);
      const { id } = request.params as { id: string };
      return service.submitFunding(id, callerId, request.body as ShipmentFundingRequest);
    },
  );
}

/**
 * MOVO-210 (AC13): endpoint INTERNO que `svc-payments` llama cuando MP cancela o vence un
 * hold (MOVO-268). Sin ruta en el gateway (perimetral, ADR-010); sin `x-user-id`: el caller
 * es otro servicio. Montado bajo `/internal`: `POST /internal/shipments/:id/hold-events`.
 */
export async function internalFundingRoutes(app: FastifyInstance, opts: FundingRoutesOptions) {
  const service = buildFundingService(app, opts);

  app.post(
    "/shipments/:id/hold-events",
    {
      schema: {
        hide: true,
        params: fundingSchemas.shipmentIdParam,
        body: fundingSchemas.holdEventBody,
        response: {
          200: fundingSchemas.holdEventResponse,
          404: fundingSchemas.errorResponse,
          502: fundingSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      const { id } = request.params as { id: string };
      return service.handleHoldProviderEvent(id, request.body as HoldProviderEventRequest);
    },
  );
}
