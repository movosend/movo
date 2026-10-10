import { ApiError, CarrierMpAccountStatusResponse } from "@movo/shared";

/**
 * MOVO-116: cliente HTTP síncrono hacia `movo-svc-payments` -- primera llamada de
 * svc-shipments a ese servicio (ADR-001, REST síncrono sin broker). Mismo molde que
 * `users-client.ts`: los tests inyectan un fake vía `buildApp({ paymentsClient })`.
 */
export interface PaymentsClient {
  /**
   * ¿El transportista tiene hoy una cuenta de Mercado Pago con la que se pueda cobrar?
   * Mismo criterio que el hold (MOVO-209). Lanza 502 `PAYMENTS_SERVICE_UNAVAILABLE` ante
   * cualquier falla: el bloqueo de `utils/carrier-gate.ts` falla cerrado.
   */
  getCarrierMpAccountStatus(userId: string): Promise<CarrierMpAccountStatusResponse>;
}

export interface PaymentsClientConfig {
  PAYMENTS_SERVICE_URL: string;
}

// Mismo timeout que users-client.ts: el bloqueo espera antes de fallar cerrado.
const REQUEST_TIMEOUT_MS = 5000;

export function createPaymentsClient(config: PaymentsClientConfig): PaymentsClient {
  return {
    async getCarrierMpAccountStatus(userId: string): Promise<CarrierMpAccountStatusResponse> {
      let response: Response;
      try {
        // Interno (`/internal/payments/...`, sin ruta en el gateway, ADR-010): sin
        // `x-user-id`, el usuario va en el path.
        response = await fetch(
          `${config.PAYMENTS_SERVICE_URL}/internal/payments/mp-connect/${encodeURIComponent(userId)}/status`,
          { method: "GET", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
        );
      } catch {
        throw new ApiError(502, "PAYMENTS_SERVICE_UNAVAILABLE", "No se pudo conectar con el servicio de pagos.");
      }

      if (!response.ok) {
        throw new ApiError(502, "PAYMENTS_SERVICE_UNAVAILABLE", "El servicio de pagos devolvió un error.");
      }

      const body = (await response.json()) as { linked?: unknown };
      // Una forma inesperada nunca se lee como "vinculada" (dejaría operar a quien no
      // puede cobrar) ni como "no vinculada" (bloquearía sin motivo).
      if (typeof body.linked !== "boolean") {
        throw new ApiError(502, "PAYMENTS_SERVICE_UNAVAILABLE", "El servicio de pagos devolvió una respuesta inválida.");
      }
      return { linked: body.linked };
    },
  };
}
