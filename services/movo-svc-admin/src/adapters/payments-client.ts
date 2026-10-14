import { createInternalClient, InternalClient } from "./internal-client";

/**
 * Sin métodos de negocio todavía: los suma la primera US de admin que necesite a
 * `svc-payments` (p. ej. el detalle del pago en una disputa, MOVO-34).
 */
export type PaymentsClient = InternalClient;

export function createPaymentsClient(config: { PAYMENTS_SERVICE_URL: string }): PaymentsClient {
  return createInternalClient({
    baseUrl: config.PAYMENTS_SERVICE_URL,
    serviceLabel: "pagos",
    unavailableCode: "PAYMENTS_SERVICE_UNAVAILABLE",
  });
}
