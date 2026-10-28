import {
  ApiError,
  CarrierMpAccountStatusResponse,
  CaptureHoldRequest,
  CaptureHoldResponse,
  CreateHoldRequest,
  DebtCollectionPreviewResponse,
  CreateUserLedgerEntryRequest,
  CreateUserLedgerEntryResponse,
  HoldCheckoutDataRequest,
  HoldCheckoutDataResponse,
  HoldDetailResponse,
  HoldResponse,
  RegisterCashCancellationPenaltyRequest,
  RegisterCashCancellationPenaltyResponse,
  RegisterCashCommissionRequest,
  RegisterCashCommissionResponse,
  SettlementResponse,
  UserLedgerBalanceResponse,
} from "@movo/shared";
import { isUserDebtOverdue } from "../domain/user-debt";

/**
 * MOVO-313 (DD-044): estado de la deuda de la cuenta corriente de una persona, ya
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
 * - MOVO-37: envíos en efectivo (`/internal/payments/cash-shipments/*`): la comisión al entregar y la
 *   penalidad del emisor sin hold, las dos por la cuenta corriente.
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
  /**
   * MOVO-311: cuánto de su deuda se le descontaría al transportista al cobrar cada uno de estos precios
   * (mismo orden). Es solo para mostrar: ante cualquier falla devuelve `null` en vez de lanzar, y quien
   * lo muestra lo omite (el hold vuelve a calcularlo al crearse).
   */
  previewCarrierDebt(userId: string, amountsArs: number[]): Promise<DebtCollectionPreviewResponse | null>;
  /**
   * AC1 de MOVO-209: `public_key` del transportista + comisión. 409 si no tiene cuenta vinculada.
   * MOVO-311: con `payerUserId`, el monto ya suma la deuda del emisor (vista previa).
   */
  getCheckoutData(input: HoldCheckoutDataRequest): Promise<HoldCheckoutDataResponse>;
  /**
   * Crea la reserva (idempotente por envío: un hold vivo se devuelve tal cual). Un rechazo
   * de la tarjeta NO lanza: vuelve con `status: "rejected"` + `failureReason`.
   */
  createHold(input: CreateHoldRequest): Promise<HoldResponse>;
  /** Hold más reciente del envío, o `null` si nunca se intentó (404 `HOLD_NOT_FOUND`). */
  findHoldByShipment(shipmentId: string, options?: { sync?: boolean; timeoutMs?: number }): Promise<HoldDetailResponse | null>;
  /**
   * Libera (cancela sin cobrar) el hold del envío. Idempotente en payments. `null` si el
   * envío nunca tuvo hold. Lanza si payments no puede confirmar la liberación.
   */
  releaseHold(shipmentId: string, expectedCarrierId?: string, expectedHoldId?: string): Promise<HoldResponse | null>;
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
   * MOVO-307 (DD-044): registra un movimiento en la cuenta corriente del usuario.
   * Idempotente por `idempotencyKey`: reenviar el mismo cuerpo devuelve el movimiento ya creado.
   */
  createLedgerEntry(userId: string, entry: CreateUserLedgerEntryRequest): Promise<CreateUserLedgerEntryResponse>;
  /**
   * MOVO-37 (B6): registra la comisión de Movo de un envío en efectivo entregado como deuda del transportista.
   * payments la calcula con la misma función que el `application_fee` y es idempotente por envío. Lanza si
   * payments falla: quien llama deja el envío en `delivered` para que lo retome el barrido.
   */
  registerCashCommission(shipmentId: string, input: RegisterCashCommissionRequest): Promise<RegisterCashCommissionResponse>;
  /**
   * MOVO-37 (B7): penalidad del emisor de un envío en efectivo como deuda de su cuenta corriente, con la
   * compensación del transportista como crédito, en una sola operación idempotente por envío.
   */
  registerCashCancellationPenalty(
    shipmentId: string,
    input: RegisterCashCancellationPenaltyRequest
  ): Promise<RegisterCashCancellationPenaltyResponse>;
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

type SerializedError = { error?: { code?: string; message?: string; details?: Record<string, unknown> } };

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
    // MOVO-311: `HOLD_AMOUNT_CHANGED` trae el total actual en `details.totalArs`.
    body.error?.details,
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

  async function postCashShipment<T>(shipmentId: string, action: string, body: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(
        `${config.PAYMENTS_SERVICE_URL}/internal/payments/cash-shipments/${encodeURIComponent(shipmentId)}/${action}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(LEDGER_TIMEOUT_MS),
        },
      );
    } catch {
      throw new ApiError(502, "PAYMENTS_SERVICE_UNAVAILABLE", "No se pudo conectar con el servicio de pagos.");
    }
    if (!response.ok) {
      throw await parseApiError(response, "El servicio de pagos devolvió un error.");
    }
    return (await response.json()) as T;
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

    async previewCarrierDebt(userId, amountsArs) {
      if (amountsArs.length === 0) return { pendingBalanceArs: 0, debtOffsetsArs: [] };
      try {
        const response = await fetch(
          `${config.PAYMENTS_SERVICE_URL}/internal/payments/users/${encodeURIComponent(userId)}/debt-collection/preview`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ amountsArs }),
            signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
          },
        );
        if (!response.ok) return null;
        const body = (await response.json()) as Partial<DebtCollectionPreviewResponse>;
        const offsets = body.debtOffsetsArs;
        if (
          typeof body.pendingBalanceArs !== "number" ||
          !Array.isArray(offsets) ||
          offsets.length !== amountsArs.length ||
          !offsets.every((o) => typeof o === "number" && Number.isFinite(o))
        ) {
          return null;
        }
        return { pendingBalanceArs: body.pendingBalanceArs, debtOffsetsArs: offsets };
      } catch {
        return null;
      }
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
      const response = await callHolds(
        `/by-shipment/${encodeURIComponent(shipmentId)}${query}`,
        { method: "GET" },
        options.timeoutMs ?? HOLD_TIMEOUT_MS,
      );
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw await parseApiError(response, "El servicio de pagos devolvió un error.");
      }
      return (await response.json()) as HoldDetailResponse;
    },

    async releaseHold(shipmentId, expectedCarrierId, expectedHoldId) {
      const params = new URLSearchParams();
      if (expectedCarrierId) params.set("expectedCarrierId", expectedCarrierId);
      if (expectedHoldId) params.set("expectedHoldId", expectedHoldId);
      const query = params.size ? `?${params.toString()}` : "";
      const response = await callHolds(`/by-shipment/${encodeURIComponent(shipmentId)}/release${query}`, { method: "POST" });
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

    async registerCashCommission(shipmentId, input) {
      return postCashShipment<RegisterCashCommissionResponse>(shipmentId, "commission", input);
    },

    async registerCashCancellationPenalty(shipmentId, input) {
      return postCashShipment<RegisterCashCancellationPenaltyResponse>(shipmentId, "cancellation-penalty", input);
    },
  };
}
