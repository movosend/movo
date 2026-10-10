import { FastifyInstance, FastifyPluginOptions, FastifyRequest } from "fastify";
import { createNotificationsClient, NotificationsClient } from "../../adapters/notifications-client";
import { createPaymentsClient, PaymentsClient } from "../../adapters/payments-client";
import { createShipmentRepository } from "../../repositories/shipment-repository";
import { requireUserIdFromHeader } from "../../utils/require-user-id";
import { createSettlementService, SettlementService } from "./settlement.service";
import { settlementSchemas } from "./settlements.schema";

export interface SettlementRoutesOptions extends FastifyPluginOptions {
  /** Overrides solo para tests de integración -- mismo criterio que el resto de los módulos. */
  notificationsClient?: NotificationsClient;
  paymentsClient?: PaymentsClient;
}

/**
 * Arma el service de liquidación; lo comparten el notifier real del handshake, el barrido y
 * las rutas. El dedupe de los pushes (Redis `SET NX`) se cablea SIEMPRE acá, así la captura en
 * línea y el barrido comparten las mismas marcas y no llegan dos avisos.
 */
export function buildSettlementService(app: FastifyInstance, opts: SettlementRoutesOptions = {}): SettlementService {
  return createSettlementService({
    repository: createShipmentRepository(app.db),
    paymentsClient: opts.paymentsClient ?? createPaymentsClient(app.config),
    notificationsClient: opts.notificationsClient ?? createNotificationsClient(app.config),
    logger: app.log,
    claimNotificationOnce: async (key, ttlSeconds) =>
      (await app.redis.set(`notified:${key}`, "1", "EX", ttlSeconds, "NX")) === "OK",
  });
}

/**
 * MOVO-212 (AC10): `GET /shipments/:id/settlement`, el pago del envío con visibilidad por
 * rol. Alimenta el detalle del pago en la app (MOVO-214).
 */
export default async function settlementRoutes(app: FastifyInstance, opts: SettlementRoutesOptions) {
  const service = buildSettlementService(app, opts);

  app.get(
    "/:id/settlement",
    {
      schema: {
        summary: "Pago del envío, según el rol de quien consulta",
        description:
          "MOVO-212 AC10: el transportista ve bruto, fee de Mercado Pago, comisión de Movo y neto; el " +
          "emisor solo el total pagado y la fecha; el receptor no accede (403). `status` es " +
          "`processing` (todavía se está cobrando), `credited` o `escalated`.",
        tags: ["settlements"],
        params: settlementSchemas.shipmentIdParam,
        response: {
          200: settlementSchemas.settlementResponse,
          401: settlementSchemas.errorResponse,
          403: settlementSchemas.errorResponse,
          404: settlementSchemas.errorResponse,
          502: settlementSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest) => {
      const callerId = requireUserIdFromHeader(request);
      const { id } = request.params as { id: string };
      return service.getForUser(id, callerId);
    }
  );
}
