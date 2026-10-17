import {
  ApiError,
  CarrierMpAccountStatusResponse,
  CaptureHoldRequest,
  CaptureHoldResponse,
  CreateHoldRequest,
  CreateUserLedgerEntryRequest,
  CreateUserLedgerEntryResponse,
  HoldCheckoutDataRequest,
  HoldCheckoutDataResponse,
  HoldResponse,
  SettlementResponse,
  UserLedgerBalanceResponse,
} from "@movo/shared";
import { isUserDebtOverdue } from "../domain/user-debt";

/**
 * MOVO-313 (ADR-044): estado de la deuda de la cuenta corriente de una persona, ya
 * interpretado contra el umbral `USER_DEBT_OVERDUE_DAYS`. Trae el saldo y la fecha solo para
 * que el llamador pueda loguear el motivo; el contrato hacia la app es el 403 del gate.
 */
export interface UserDebtStatus {
  overdue: boolean;
  balanceArs: number;
  oldestUnpaidAt: string | null;
}

/**
 * Cliente HTTP síncrono hacia `movo-svc-payments` (ADR-001, REST síncrono sin broker). Mismo
 * molde que `users-client.ts`: los tests inyectan un fake vía `buildApp({ paymentsClient })`.
 *
 * - MOVO-116: estado de la cuenta de MP del transportista (bloqueo de `utils/carrier-gate.ts`).
 * - MOVO-313: deuda vencida de la cuenta corriente (mismo bloqueo, mismo criterio de falla cerrada).
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
  /**
   * MOVO-313: ¿la persona tiene una deuda sin saldar hace más de `USER_DEBT_OVERDUE_DAYS`?
   * Consulta el saldo de la cuenta corriente (`GET /internal/payments/users/:userId/balance`,
   * MOVO-309) en cada llamada, sin cache: al saldar la deuda el bloqueo se levanta en la
   * siguiente consulta. Lanza 502 `PAYMENTS_SERVICE_UNAVAILABLE` ante cualquier falla: el
   * bloqueo de `utils/carrier-gate.ts` falla cerrado. `now` es solo para tests.
   */
  getUserDebtStatus(userId: string, now?: Date): Promise<UserDebtStatus>;
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
  /**
   * MOVO-212: captura el hold del envío entregado y devuelve la liquidación. Idempotente en
   * payments: una liquidación ya acreditada vuelve tal cual sin volver a cobrar. Lanza si la
   * captura no se pudo completar (409 `HOLD_NOT_CAPTURABLE`, `CARRIER_MP_ACCOUNT_NOT_LINKED`,
   * 404 `HOLD_NOT_FOUND`, 502 `PAYMENT_PROVIDER_ERROR`...): el envío NO se toca.
   */
  captureHold(shipmentId: string, request?: CaptureHoldRequest): Promise<SettlementResponse>;
  /** MOVO-212: liquidación del envío, o `null` si todavía no se pidió la captura. */
  findSettlement(shipmentId: string): Promise<SettlementResponse | null>;
  /**
   * MOVO-307 (ADR-044): registra un movimiento en la cuenta corriente del usuario.
   * Idempotente por `idempotencyKey`: reenviar el mismo cuerpo devuelve el movimiento ya creado.
   */
  createLedgerEntry(userId: string, entry: CreateUserLedgerEntryRequest): Promise<CreateUserLedgerEntryResponse>;
}

export interface PaymentsClientConfig {
  PAYMENTS_SERVICE_URL: string;
  /** MOVO-313: antigüedad (días) a partir de la cual una deuda sin saldar bloquea al
   * transportista. Va acá y no en cada servicio que arma el gate porque todos reciben el
   * mismo cliente (`createPaymentsClient(app.config)`): un solo lugar donde puede olvidarse. */
  USER_DEBT_OVERDUE_DAYS: number;
}

// El bloqueo de MOVO-116 espera poco antes de fallar cerrado (mismo timeout que users-client).
const STATUS_TIMEOUT_MS = 5000;
// Crear el hold llama a Mercado Pago (timeout propio de 10s en payments): un margen
// holgado para no cortar del lado de shipments una reserva que MP sí está procesando.
const HOLD_TIMEOUT_MS = 20_000;
// Capturar hace dos llamadas a MP en serie (capturar y leer el desglose, ~22s cada una en el
// peor caso con el reintento del SDK): con 20s se cortaría una captura que MP sí procesa. Es
// seguro reintentar porque la captura es idempotente (key por hold + fila por envío).
const CAPTURE_TIMEOUT_MS = 50_000;
const HOLDS_PATH = "/internal/payments/holds";
const LEDGER_TIMEOUT_MS = 5000;

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
  // MOVO-313: con `undefined`/`NaN`, `edad > undefined * DAY_MS` es siempre `false` y nadie quedaría
  // bloqueado, sin error ni log: un gate que debe fallar cerrado fallaría abierto. Se corta al armar
  // el cliente (arranque del servicio) en vez de degradar en silencio.
  if (!Number.isFinite(config.USER_DEBT_OVERDUE_DAYS) || config.USER_DEBT_OVERDUE_DAYS < 0) {
    throw new Error(
      `USER_DEBT_OVERDUE_DAYS inválido (${String(config.USER_DEBT_OVERDUE_DAYS)}): tiene que ser un número >= 0.`,
    );
  }

  async function callHolds(path: string, init: RequestInit, timeoutMs = HOLD_TIMEOUT_MS): Promise<Response> {
    try {
      return await fetch(`${config.PAYMENTS_SERVICE_URL}${HOLDS_PATH}${path}`, {
        ...init,
        // Solo con body: un POST sin body con `content-type: application/json` lo rechaza el
        // parser de Fastify de payments (MOVO-307, rompía la captura y la liberación).
        headers: { ...(init.body !== undefined ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(timeoutMs),
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

    async getUserDebtStatus(userId, now = new Date()) {
      let response: Response;
      try {
        // Interno (sin ruta en el gateway, ADR-010): sin `x-user-id`, el usuario va en el path.
        response = await fetch(
          `${config.PAYMENTS_SERVICE_URL}/internal/payments/users/${encodeURIComponent(userId)}/balance`,
          { method: "GET", signal: AbortSignal.timeout(STATUS_TIMEOUT_MS) },
        );
      } catch {
        throw new ApiError(502, "PAYMENTS_SERVICE_UNAVAILABLE", "No se pudo conectar con el servicio de pagos.");
      }

      if (!response.ok) {
        throw new ApiError(502, "PAYMENTS_SERVICE_UNAVAILABLE", "El servicio de pagos devolvió un error.");
      }

      let body: Partial<UserLedgerBalanceResponse>;
      try {
        body = (await response.json()) as Partial<UserLedgerBalanceResponse>;
      } catch {
        body = {};
      }
      const { balanceArs, oldestUnpaidAt } = body;
      // Una forma inesperada nunca se lee como "sin deuda" (dejaría operar a quien debe) ni como
      // "deuda vencida" (bloquearía sin motivo): se rechaza, igual que el estado de MP.
      const validDate =
        oldestUnpaidAt === null || (typeof oldestUnpaidAt === "string" && !Number.isNaN(Date.parse(oldestUnpaidAt)));
      if (typeof balanceArs !== "number" || !Number.isFinite(balanceArs) || oldestUnpaidAt === undefined || !validDate) {
        throw new ApiError(502, "PAYMENTS_SERVICE_UNAVAILABLE", "El servicio de pagos devolvió una respuesta inválida.");
      }

      return {
        overdue: isUserDebtOverdue({ balanceArs, oldestUnpaidAt }, now, config.USER_DEBT_OVERDUE_DAYS),
        balanceArs,
        oldestUnpaidAt,
      };
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

    async captureHold(shipmentId, request) {
      const response = await callHolds(
        `/by-shipment/${encodeURIComponent(shipmentId)}/capture`,
        // Sin `request` es la captura de entrega de MOVO-212, tal cual.
        { method: "POST", ...(request ? { body: JSON.stringify(request) } : {}) },
        CAPTURE_TIMEOUT_MS,
      );
      if (!response.ok) {
        throw await parseApiError(response, "El servicio de pagos devolvió un error.");
      }
      return ((await response.json()) as CaptureHoldResponse).settlement;
    },

    async findSettlement(shipmentId) {
      const response = await callHolds(`/by-shipment/${encodeURIComponent(shipmentId)}/settlement`, { method: "GET" });
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw await parseApiError(response, "El servicio de pagos devolvió un error.");
      }
      return (await response.json()) as SettlementResponse;
    },

    async createLedgerEntry(userId, entry) {
      let response: Response;
      try {
        response = await fetch(
          `${config.PAYMENTS_SERVICE_URL}/internal/payments/users/${encodeURIComponent(userId)}/ledger-entries`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(entry),
            signal: AbortSignal.timeout(LEDGER_TIMEOUT_MS),
          },
        );
      } catch {
        throw new ApiError(502, "PAYMENTS_SERVICE_UNAVAILABLE", "No se pudo conectar con el servicio de pagos.");
      }
      if (!response.ok) {
        throw await parseApiError(response, "El servicio de pagos devolvió un error.");
      }
      return (await response.json()) as CreateUserLedgerEntryResponse;
    },
  };
}
