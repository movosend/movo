import {
  ApiError,
  CarrierMpAccountStatusResponse,
  CreateHoldRequest,
  HoldCheckoutDataRequest,
  HoldCheckoutDataResponse,
  HoldResponse,
} from "@movo/shared";

/**
 * Cliente HTTP síncrono hacia `movo-svc-payments` (ADR-001, REST síncrono sin broker). Mismo
 * molde que `users-client.ts`: los tests inyectan un fake vía `buildApp({ paymentsClient })`.
 *
 * - MOVO-116: estado de la cuenta de MP del transportista (bloqueo de `utils/carrier-gate.ts`).
 * - MOVO-210: endpoints INTERNOS de holds (MOVO-209, `/internal/payments/holds/*`). `svc-shipments`
 *   es dueño de la saga y única puerta del mobile: el mobile nunca le habla a payments.
 *
 * Sin `x-user-id` (el caller es otro servicio, ADR-010). Los errores de negocio de payments
 * (409 `CARRIER_MP_ACCOUNT_NOT_LINKED`, 502 `PAYMENT_PROVIDER_ERROR`...) se re-lanzan como
 * `ApiError` con su mismo código; una red caída o un timeout es 502 `PAYMENTS_SERVICE_UNAVAILABLE`.
 */
export interface PaymentsClient {
  /**
   * MOVO-116: ¿el transportista tiene hoy una cuenta de Mercado Pago con la que se pueda
   * cobrar? Mismo criterio que el hold (MOVO-209). Lanza 502 `PAYMENTS_SERVICE_UNAVAILABLE` ante
   * cualquier falla: el bloqueo de `utils/carrier-gate.ts` falla cerrado.
   */
  getCarrierMpAccountStatus(userId: string): Promise<CarrierMpAccountStatusResponse>;
  /** AC1 de MOVO-209: `public_key` del transportista + comisión. 409 si no tiene cuenta vinculada. */
  getCheckoutData(input: HoldCheckoutDataRequest): Promise<HoldCheckoutDataResponse>;
  /**
   * Crea la reserva (idempotente por envío: un hold vivo se devuelve tal cual). Un rechazo
   * de la tarjeta NO lanza: vuelve con `status: "rejected"` + `failureReason`.
   */
  createHold(input: CreateHoldRequest): Promise<HoldResponse>;
  /** Hold más reciente del envío, o `null` si nunca se intentó (404 `HOLD_NOT_FOUND`). */
  findHoldByShipment(shipmentId: string, options?: { sync?: boolean }): Promise<HoldResponse | null>;
  /**
   * Libera (cancela sin cobrar) el hold del envío. Idempotente en payments. `null` si el
   * envío nunca tuvo hold. Lanza si payments no puede confirmar la liberación.
   */
  releaseHold(shipmentId: string): Promise<HoldResponse | null>;
}

export interface PaymentsClientConfig {
  PAYMENTS_SERVICE_URL: string;
}

// El bloqueo de MOVO-116 espera poco antes de fallar cerrado (mismo timeout que users-client).
const STATUS_TIMEOUT_MS = 5000;
// Crear el hold llama a Mercado Pago (timeout propio de 10s en payments): un margen
// holgado para no cortar del lado de shipments una reserva que MP sí está procesando.
const HOLD_TIMEOUT_MS = 20_000;
const HOLDS_PATH = "/internal/payments/holds";

type SerializedError = { error?: { code?: string; message?: string } };

async function parseApiError(response: Response, fallbackMessage: string): Promise<ApiError> {
  let body: SerializedError = {};
  try {
    body = (await response.json()) as SerializedError;
  } catch {
    // cuerpo no JSON: se usa el fallback.
  }
  const code = (body.error?.code ?? "PAYMENT_PROVIDER_ERROR") as ApiError["code"];
  return new ApiError(
    response.status >= 400 && response.status < 600 ? response.status : 502,
    code,
    body.error?.message ?? fallbackMessage,
  );
}

export function createPaymentsClient(config: PaymentsClientConfig): PaymentsClient {
  async function callHolds(path: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(`${config.PAYMENTS_SERVICE_URL}${HOLDS_PATH}${path}`, {
        ...init,
        headers: { "content-type": "application/json", ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(HOLD_TIMEOUT_MS),
      });
    } catch {
      throw new ApiError(502, "PAYMENTS_SERVICE_UNAVAILABLE", "No se pudo conectar con el servicio de pagos.");
    }
  }

  return {
    async getCarrierMpAccountStatus(userId: string): Promise<CarrierMpAccountStatusResponse> {
      let response: Response;
      try {
        // Interno (`/internal/payments/...`, sin ruta en el gateway, ADR-010): sin
        // `x-user-id`, el usuario va en el path.
        response = await fetch(
          `${config.PAYMENTS_SERVICE_URL}/internal/payments/mp-connect/${encodeURIComponent(userId)}/status`,
          { method: "GET", signal: AbortSignal.timeout(STATUS_TIMEOUT_MS) },
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

    async getCheckoutData(input) {
      const response = await callHolds("/checkout-data", { method: "POST", body: JSON.stringify(input) });
      if (!response.ok) {
        throw await parseApiError(response, "El servicio de pagos devolvió un error.");
      }
      return (await response.json()) as HoldCheckoutDataResponse;
    },

    async createHold(input) {
      const response = await callHolds("/", { method: "POST", body: JSON.stringify(input) });
      if (!response.ok) {
        throw await parseApiError(response, "El servicio de pagos devolvió un error.");
      }
      return (await response.json()) as HoldResponse;
    },

    async findHoldByShipment(shipmentId, options = {}) {
      const query = options.sync ? "?sync=true" : "";
      const response = await callHolds(`/by-shipment/${encodeURIComponent(shipmentId)}${query}`, { method: "GET" });
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw await parseApiError(response, "El servicio de pagos devolvió un error.");
      }
      return (await response.json()) as HoldResponse;
    },

    async releaseHold(shipmentId) {
      const response = await callHolds(`/by-shipment/${encodeURIComponent(shipmentId)}/release`, { method: "POST" });
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw await parseApiError(response, "El servicio de pagos devolvió un error.");
      }
      return (await response.json()) as HoldResponse;
    },
  };
}
