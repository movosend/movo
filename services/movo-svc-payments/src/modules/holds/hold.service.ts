import type { FastifyBaseLogger } from "fastify";
import {
  ApiError,
  CreateHoldRequest,
  decomposeOfferGrossPrice,
  HoldCheckoutDataRequest,
  HoldCheckoutDataResponse,
  HoldFailureReason,
  HoldResponse,
  HoldStatus,
} from "@movo/shared";
import { MercadoPagoClient, PaymentResponse } from "../../adapters/mercadopago-client";
import { CarrierMpAccountRepository } from "../../repositories/carrier-mp-account-repository";
import { Hold, HoldAttemptConflictError, HoldRepository, HoldUpdate } from "../../repositories/hold-repository";
import { toStatusResponse } from "../mp-connect/mp-connect.service";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Intentos que ya no tienen (ni pueden tener) fondos reservados en MP. */
const CLOSED_STATUSES: readonly HoldStatus[] = ["rejected", "cancelled"];

/**
 * `status_detail` de MP cuando la tarjeta se rechazó por un dato mal cargado: el emisor
 * lo corrige en el formulario. Lista de la documentación de MP (Argentina).
 */
const INVALID_DATA_DETAILS = new Set([
  "cc_rejected_bad_filled_card_number",
  "cc_rejected_bad_filled_date",
  "cc_rejected_bad_filled_other",
  "cc_rejected_bad_filled_security_code",
  "cc_rejected_invalid_installments",
]);

/**
 * Rechazos que no dependen de la tarjeta del emisor sino de la operación o de MP.
 * Un `cc_rejected_*` que no figura en ningún set es un rechazo genérico de la tarjeta.
 */
const PLATFORM_DETAILS = new Set(["rejected_by_regulations", "rejected_insufficient_data"]);

/** Códigos de error de la API de MP (no de rechazo) que apuntan al `card_token` enviado. */
const INVALID_TOKEN_CAUSE_CODES = new Set(["2006", "3001", "3003"]);

export function failureReasonFromStatusDetail(statusDetail: string | null | undefined): HoldFailureReason {
  if (statusDetail === "cc_rejected_insufficient_amount") return "insufficient_funds";
  if (statusDetail && INVALID_DATA_DETAILS.has(statusDetail)) return "invalid_data";
  if (statusDetail && PLATFORM_DETAILS.has(statusDetail)) return "platform_error";
  if (statusDetail?.startsWith("cc_rejected_")) return "card_rejected";
  return "platform_error";
}

interface MpErrorInfo {
  status: number | undefined;
  causeCodes: string[];
  message: string;
}

/**
 * El SDK tira el cuerpo JSON de error de MP tal cual (`{ message, error, status, cause:
 * [{ code, description }] }`, no una instancia de `Error`), y un `Error` común ante un
 * timeout o un corte de red. Se lee de forma defensiva: nunca se asume la forma.
 */
export function readMpError(error: unknown): MpErrorInfo {
  if (typeof error !== "object" || error === null) {
    return { status: undefined, causeCodes: [], message: String(error) };
  }
  const raw = error as { status?: unknown; message?: unknown; cause?: unknown };
  const causes: unknown[] = Array.isArray(raw.cause) ? raw.cause : [];
  return {
    status: typeof raw.status === "number" ? raw.status : undefined,
    causeCodes: causes
      .map((c) => (typeof c === "object" && c !== null ? (c as { code?: unknown }).code : undefined))
      .filter((c): c is string | number => typeof c === "string" || typeof c === "number")
      .map(String),
    message: typeof raw.message === "string" ? raw.message : "error sin mensaje",
  };
}

const roundArs = (value: number): number => Math.round(value * 100) / 100;

function toHoldResponse(hold: Hold): HoldResponse {
  return {
    id: hold.id,
    shipmentId: hold.shipmentId,
    carrierId: hold.carrierId,
    attempt: hold.attempt,
    mpPaymentId: hold.mpPaymentId,
    collectorId: hold.collectorId,
    amountArs: hold.amountArs.toNumber(),
    applicationFeeArs: hold.applicationFeeArs.toNumber(),
    status: hold.status,
    statusDetail: hold.statusDetail,
    failureReason: hold.failureReason,
    expiresAt: hold.expiresAt?.toISOString() ?? null,
    createdAt: hold.createdAt.toISOString(),
    updatedAt: hold.updatedAt.toISOString(),
  };
}

export interface HoldServiceDeps {
  /** `MP_HOLD_VALIDITY_DAYS`: cuánto se espera que MP sostenga la reserva (AC4). */
  holdValidityDays: number;
  holds: HoldRepository;
  accounts: CarrierMpAccountRepository;
  mercadoPago: MercadoPagoClient;
  log: FastifyBaseLogger;
  now?: () => Date;
}

export interface CreateHoldResult {
  hold: HoldResponse;
  /** `true` si no se le pegó a MP: el envío ya tenía un hold vigente (reintento). */
  replayed: boolean;
}

/**
 * MOVO-209: crea, consulta y libera la reserva de fondos de un envío. Único camino de
 * `svc-shipments` (dueño de la saga, MOVO-210) hacia los holds.
 *
 * **Idempotencia (AC6).** Hay una fila por intento (`shipmentId` + `attempt`) y la
 * `X-Idempotency-Key` es `movo-hold-<shipmentId>-<attempt>`:
 * - un hold vivo del envío se devuelve tal cual, sin llamar a MP;
 * - un intento que quedó en `creating` (respuesta perdida, timeout) se reintenta con la
 *   MISMA key, así MP devuelve el pago ya creado en vez de crear otro;
 * - solo tras un rechazo o una liberación el intento siguiente usa otra key.
 * Además un índice único parcial en la base impide dos holds vivos por envío aunque dos
 * requests lleguen a la vez.
 */
export function createHoldService(deps: HoldServiceDeps) {
  const { holds, accounts, mercadoPago, log } = deps;
  const now = deps.now ?? (() => new Date());

  const idempotencyKey = (shipmentId: string, attempt: number) => `movo-hold-${shipmentId}-${attempt}`;

  /** El transportista tiene que tener la cuenta vigente (no desvinculada, revocada ni vencida). */
  async function requireLinkedCarrier(carrierId: string) {
    const notLinked = () =>
      new ApiError(
        409,
        "CARRIER_MP_ACCOUNT_NOT_LINKED",
        "El transportista no tiene una cuenta de Mercado Pago vinculada y vigente"
      );
    const account = await accounts.findByUserId(carrierId);
    if (toStatusResponse(account, now()).status !== "linked") throw notLinked();
    const credentials = await accounts.findCredentials(carrierId);
    if (!credentials || !credentials.publicKey) throw notLinked();
    return { ...credentials, publicKey: credentials.publicKey };
  }

  function sameTerms(hold: Hold, carrierId: string, amountArs: number): boolean {
    return hold.carrierId === carrierId && hold.amountArs.toNumber() === amountArs;
  }

  function mapPayment(payment: PaymentResponse, current: Hold | null): HoldUpdate {
    const statusDetail = payment.status_detail ?? null;
    const mpPaymentId = payment.id !== undefined ? String(payment.id) : null;
    const expiresAt = current?.expiresAt ?? new Date(now().getTime() + deps.holdValidityDays * DAY_MS);
    switch (payment.status) {
      case "authorized":
        return { status: "authorized", statusDetail, failureReason: null, mpPaymentId, expiresAt };
      case "in_process":
      case "pending":
        return { status: "in_process", statusDetail, failureReason: null, mpPaymentId, expiresAt };
      case "approved":
        // Con `capture: false` no debería pasar; si pasa, la plata ya se cobró.
        return { status: "captured", statusDetail, failureReason: null, mpPaymentId, expiresAt: null };
      case "cancelled":
        return { status: "cancelled", statusDetail, failureReason: null, mpPaymentId, expiresAt: null };
      case "rejected":
        return {
          status: "rejected",
          statusDetail,
          failureReason: failureReasonFromStatusDetail(statusDetail),
          mpPaymentId,
          expiresAt: null,
        };
      default:
        log.error(
          { mpPaymentId, mpStatus: payment.status, mpStatusDetail: statusDetail },
          "estado de pago de MP desconocido"
        );
        return { status: "rejected", statusDetail, failureReason: "platform_error", mpPaymentId, expiresAt: null };
    }
  }

  /**
   * Decide qué intento procesar. `replay` = ya hay un hold vigente, no se toca MP;
   * `process` = hay que (re)intentar la llamada a MP con la key de ese intento.
   */
  async function resolveAttempt(
    input: CreateHoldRequest,
    amountArs: number,
    applicationFeeArs: number,
    collectorId: string
  ): Promise<{ kind: "replay" | "process"; hold: Hold }> {
    for (let tries = 0; tries < 3; tries += 1) {
      const latest = await holds.findLatestByShipment(input.shipmentId);

      if (latest && !CLOSED_STATUSES.includes(latest.status)) {
        if (sameTerms(latest, input.carrierId, amountArs)) {
          return { kind: latest.status === "creating" ? "process" : "replay", hold: latest };
        }
        if (latest.status !== "creating") {
          throw new ApiError(
            409,
            "HOLD_CONFLICT",
            "El envío ya tiene un hold vigente con otro transportista o monto: liberalo antes de crear otro"
          );
        }
        // Intento sin respuesta de MP con otro transportista o monto: el envío se
        // reasignó antes de resolverlo. No se puede reusar la key (MP devolvería el pago
        // viejo con otro cuerpo); se cierra y se abre uno nuevo. Si MP llegó a crearlo,
        // queda un hold huérfano que vence solo (ver CLAUDE.md, MOVO-209).
        log.warn(
          { shipmentId: input.shipmentId, holdId: latest.id, attempt: latest.attempt },
          "intento de hold sin resolver reemplazado por cambio de transportista o monto"
        );
        await holds.update(latest.id, { status: "rejected", statusDetail: "superseded", failureReason: "platform_error" });
      }

      try {
        const created = await holds.createAttempt({
          shipmentId: input.shipmentId,
          attempt: (latest?.attempt ?? 0) + 1,
          carrierId: input.carrierId,
          collectorId,
          amountArs,
          applicationFeeArs,
        });
        return { kind: "process", hold: created };
      } catch (error) {
        // Otro request ganó la carrera: se vuelve a leer y se decide con lo que dejó.
        if (!(error instanceof HoldAttemptConflictError)) throw error;
      }
    }
    throw new ApiError(409, "HOLD_CONFLICT", "No se pudo resolver el intento de hold por concurrencia, reintentá");
  }

  return {
    /** AC1: lo que el mobile necesita para tokenizar la tarjeta y mostrar el monto. */
    async getCheckoutData(input: HoldCheckoutDataRequest): Promise<HoldCheckoutDataResponse> {
      const carrier = await requireLinkedCarrier(input.carrierId);
      const amountArs = roundArs(input.amountArs);
      return {
        shipmentId: input.shipmentId,
        publicKey: carrier.publicKey,
        amountArs,
        applicationFeeArs: decomposeOfferGrossPrice(amountArs).commissionAmountArs,
        payerEmail: input.payerEmail,
      };
    },

    /** AC2/AC3/AC5/AC6. Un rechazo de la tarjeta NO es un error HTTP: vuelve como hold `rejected`. */
    async create(input: CreateHoldRequest): Promise<CreateHoldResult> {
      const carrier = await requireLinkedCarrier(input.carrierId);
      const amountArs = roundArs(input.amountArs);
      // La comisión sale de `@movo/shared`: `amountArs` es el bruto que ve el emisor
      // (`Offer.priceOffered`) y Movo cobra su % sobre el neto del transportista.
      const applicationFeeArs = decomposeOfferGrossPrice(amountArs).commissionAmountArs;

      const { kind, hold } = await resolveAttempt(input, amountArs, applicationFeeArs, carrier.mpUserId);
      if (kind === "replay") {
        log.info(
          { shipmentId: hold.shipmentId, holdId: hold.id, status: hold.status },
          "hold ya vigente, no se vuelve a crear"
        );
        return { hold: toHoldResponse(hold), replayed: true };
      }

      const key = idempotencyKey(hold.shipmentId, hold.attempt);
      // AC9: ni el card_token ni el email del pagador se loguean.
      log.info(
        { shipmentId: hold.shipmentId, holdId: hold.id, attempt: hold.attempt, amountArs, applicationFeeArs },
        "creando hold en MP"
      );

      let payment: PaymentResponse;
      try {
        payment = await mercadoPago.createPayment(
          carrier.accessToken,
          {
            transaction_amount: amountArs,
            capture: false,
            installments: 1,
            token: input.cardToken,
            ...(input.paymentMethodId ? { payment_method_id: input.paymentMethodId } : {}),
            description: `Envío MOVO ${hold.shipmentId}`,
            // Para que MOVO-268 pueda reconciliar un pago contra el envío desde el webhook.
            external_reference: hold.shipmentId,
            payer: { email: input.payerEmail },
            application_fee: applicationFeeArs,
          },
          key
        );
      } catch (error) {
        const info = readMpError(error);
        if (info.status !== undefined && info.status >= 400 && info.status < 500) {
          // MP rechazó el REQUEST (token ya usado o inválido, cuentas, etc.): el intento
          // terminó sin hold, y el siguiente usa otra key.
          const failureReason: HoldFailureReason = info.causeCodes.some((c) => INVALID_TOKEN_CAUSE_CODES.has(c))
            ? "invalid_data"
            : "platform_error";
          log.warn(
            { shipmentId: hold.shipmentId, holdId: hold.id, mpHttpStatus: info.status, mpCauseCodes: info.causeCodes },
            "MP rechazó la creación del hold"
          );
          const rejected = await holds.update(hold.id, {
            status: "rejected",
            statusDetail: info.causeCodes[0] ? `mp_error_${info.causeCodes[0]}` : `mp_http_${info.status}`,
            failureReason,
          });
          return { hold: toHoldResponse(rejected), replayed: false };
        }
        // Timeout, red o 5xx: no se sabe si MP creó el pago. El intento queda en
        // `creating` y el reintento del caller reusa la key.
        log.error(
          { shipmentId: hold.shipmentId, holdId: hold.id, mpHttpStatus: info.status, reason: info.message },
          "MP no respondió al crear el hold"
        );
        throw new ApiError(502, "PAYMENT_PROVIDER_ERROR", "Mercado Pago no respondió: reintentá con la misma tarjeta");
      }

      const updated = await holds.update(hold.id, mapPayment(payment, hold));
      log.info(
        {
          shipmentId: updated.shipmentId,
          holdId: updated.id,
          mpPaymentId: updated.mpPaymentId,
          mpStatus: payment.status,
          mpStatusDetail: updated.statusDetail,
          failureReason: updated.failureReason,
        },
        "hold procesado por MP"
      );
      return { hold: toHoldResponse(updated), replayed: false };
    },

    /**
     * AC7. Por defecto devuelve lo persistido. Con `sync` consulta el pago a MP y
     * actualiza la fila (hasta que MOVO-268 reciba los webhooks, es la forma de ver un
     * hold que MP cambió por su cuenta).
     */
    async getByShipment(shipmentId: string, opts: { sync?: boolean } = {}): Promise<HoldResponse> {
      let hold = await holds.findLatestByShipment(shipmentId);
      if (!hold) throw new ApiError(404, "HOLD_NOT_FOUND", "El envío no tiene ningún hold");

      if (opts.sync && hold.mpPaymentId && (hold.status === "authorized" || hold.status === "in_process")) {
        const credentials = await accounts.findCredentials(hold.carrierId);
        if (!credentials) {
          log.warn({ shipmentId, holdId: hold.id }, "sin credenciales del transportista para sincronizar el hold");
        } else {
          let payment: PaymentResponse;
          try {
            payment = await mercadoPago.getPayment(credentials.accessToken, hold.mpPaymentId);
          } catch (error) {
            log.error(
              { shipmentId, holdId: hold.id, reason: readMpError(error).message },
              "falló la consulta del hold a MP"
            );
            throw new ApiError(502, "PAYMENT_PROVIDER_ERROR", "No se pudo consultar el estado a Mercado Pago");
          }
          hold = await holds.update(hold.id, mapPayment(payment, hold));
        }
      }
      return toHoldResponse(hold);
    },

    /**
     * AC8: libera sin capturar. Idempotente: un hold ya cancelado, o un intento rechazado
     * (que nunca retuvo fondos), se devuelve tal cual. Un hold capturado no se libera: eso
     * es un reembolso. Un intento en `creating` tampoco: no hay `mp_payment_id` con el
     * cual cancelar, y cerrarlo localmente dejaría un pago huérfano en MP.
     */
    async release(shipmentId: string): Promise<HoldResponse> {
      const hold = await holds.findLatestByShipment(shipmentId);
      if (!hold) throw new ApiError(404, "HOLD_NOT_FOUND", "El envío no tiene ningún hold");
      if (hold.status === "cancelled" || hold.status === "rejected") return toHoldResponse(hold);
      if (hold.status === "captured") {
        throw new ApiError(409, "HOLD_NOT_RELEASABLE", "El hold ya fue capturado: no se puede liberar");
      }
      if (hold.status === "creating" || !hold.mpPaymentId) {
        throw new ApiError(
          409,
          "HOLD_NOT_RELEASABLE",
          "El hold todavía no se confirmó con Mercado Pago: reintentá la creación o esperá a que se resuelva"
        );
      }

      const credentials = await accounts.findCredentials(hold.carrierId);
      if (!credentials) {
        throw new ApiError(
          409,
          "CARRIER_MP_ACCOUNT_NOT_LINKED",
          "No hay credenciales vigentes del transportista para liberar el hold"
        );
      }

      let payment: PaymentResponse;
      try {
        payment = await mercadoPago.cancelPayment(
          credentials.accessToken,
          hold.mpPaymentId,
          `movo-hold-release-${hold.id}`
        );
      } catch (error) {
        const info = readMpError(error);
        // Si MP ya lo había cancelado (venció o lo canceló por su cuenta), el objetivo
        // —que no queden fondos retenidos— ya está cumplido.
        try {
          const current = await mercadoPago.getPayment(credentials.accessToken, hold.mpPaymentId);
          if (current.status === "cancelled") {
            const updated = await holds.update(hold.id, mapPayment(current, hold));
            return toHoldResponse(updated);
          }
        } catch {
          // Se informa el error original de la cancelación.
        }
        log.error(
          { shipmentId, holdId: hold.id, mpHttpStatus: info.status, reason: info.message },
          "falló la liberación del hold"
        );
        throw new ApiError(502, "PAYMENT_PROVIDER_ERROR", "No se pudo liberar el hold en Mercado Pago");
      }

      const updated = await holds.update(hold.id, mapPayment(payment, hold));
      log.info(
        { shipmentId, holdId: updated.id, mpPaymentId: updated.mpPaymentId, status: updated.status },
        "hold liberado"
      );
      return toHoldResponse(updated);
    },
  };
}

export type HoldService = ReturnType<typeof createHoldService>;
