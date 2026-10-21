import { createHash } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import {
  ApiError,
  CLOSED_HOLD_STATUSES,
  CreateHoldRequest,
  DebtCollectionPreviewResponse,
  HoldCheckoutDataRequest,
  HoldCheckoutDataResponse,
  HoldFailureReason,
  HoldDetailResponse,
  HoldResponse,
} from "@movo/shared";
import { MercadoPagoClient, PaymentSnapshot } from "../../adapters/mercadopago-client";
import { CarrierMpAccountRepository } from "../../repositories/carrier-mp-account-repository";
import { SavedCardRepository } from "../../repositories/saved-card-repository";
import { Hold, HoldAmountChangedError, HoldAttemptConflictError, HoldRepository, HoldUpdate } from "../../repositories/hold-repository";
import { cardFromPayment, missingCardFields } from "../../utils/payment-card";
import { computeDebtCollection } from "./debt-collection";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Cuánto puede quedar un intento en `creating` (MP no respondió) antes de que, si MP
 * tampoco tiene el pago, se lo dé por abandonado y se cierre. MP crea el pago dentro de
 * la llamada (timeout de 10s con un reintento), así que 10 minutos sobran, y cubre el
 * retraso del índice de búsqueda de MP.
 */
export const STALE_CREATING_MS = 10 * 60 * 1000;

/** Estados de MP que dejan fondos retenidos o cobrados: el pago "existe" para un hold. */
const LIVE_MP_STATUSES = new Set(["authorized", "in_process", "pending", "approved"]);

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

/**
 * Códigos de error de la API de MP (no de rechazo) que apuntan al `card_token` enviado o a su código
 * de seguridad: token inexistente, vencido o ya usado (2006/3001/3003) y, con tarjeta guardada, el CVV
 * ausente o vacío (3031 "security_code_id can't be null") o de largo inválido (3032). Verificados en el
 * sandbox el 14/10/2026. MP los responde ANTES de crear el pago y repetirlos falla igual, así que cierran
 * el intento; el emisor lo resuelve volviendo a escribir el código.
 */
const INVALID_TOKEN_CAUSE_CODES = new Set(["2006", "3001", "3003", "3031", "3032"]);

/**
 * Errores de configuración de cuentas que MP responde con 400 antes de crear nada (por
 * ejemplo 2034 "Invalid users involved" o 2059 por usar el token equivocado): son
 * deterministas, reintentar con la misma cuenta falla igual.
 */
const PLATFORM_CAUSE_CODES = new Set(["2034", "2059"]);

/**
 * `status_detail` que, con una tarjeta guardada, no lo causó un dato mal tipeado: el emisor no
 * escribió el vencimiento, así que `bad_filled_date` significa que la tarjeta guardada venció
 * (o MP la tiene con otra fecha) y hay que probar con otra, no "revisar el dato" (MOVO-282, AC6).
 */
const SAVED_CARD_REJECTED_DETAILS = new Set(["cc_rejected_bad_filled_date"]);

export function failureReasonFromStatusDetail(
  statusDetail: string | null | undefined,
  opts: { savedCard?: boolean } = {}
): HoldFailureReason {
  if (statusDetail === "cc_rejected_insufficient_amount") return "insufficient_funds";
  if (opts.savedCard && statusDetail && SAVED_CARD_REJECTED_DETAILS.has(statusDetail)) return "card_rejected";
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
 * Errores de la API de MP vistos desde el SDK `mercadopago` 3.x: una instancia de `Error`
 * (`MPBadRequestError`, ...) con `status`, `error` y las causas de la API en **`causes`** (el SDK
 * copia ahí el `cause` del body); ante un timeout o un corte de red, un `Error` común. También se
 * acepta el cuerpo JSON crudo de la API (`cause`). Verificado contra el sandbox el 14/10/2026: con
 * el SDK real `cause` no existe, y leer solo ese campo dejaba sin reconocer ninguna causa (el
 * intento quedaba en `creating` aun con un 400 que prueba que MP no creó el pago). Se lee de forma
 * defensiva: nunca se asume la forma.
 */
export function readMpError(error: unknown): MpErrorInfo {
  if (typeof error !== "object" || error === null) {
    return { status: undefined, causeCodes: [], message: String(error) };
  }
  const raw = error as { status?: unknown; message?: unknown; cause?: unknown; causes?: unknown };
  const causes: unknown[] = Array.isArray(raw.causes) ? raw.causes : Array.isArray(raw.cause) ? raw.cause : [];
  return {
    status: typeof raw.status === "number" ? raw.status : undefined,
    causeCodes: causes
      .map((c) => (typeof c === "object" && c !== null ? (c as { code?: unknown }).code : undefined))
      .filter((c): c is string | number => typeof c === "string" || typeof c === "number")
      .map(String),
    message: typeof raw.message === "string" ? raw.message : "error sin mensaje",
  };
}

type CreateErrorOutcome =
  | { kind: "carrier_auth" }
  | { kind: "rejected"; failureReason: HoldFailureReason }
  | { kind: "transient" };

/**
 * Qué hacer con un error de MP al crear el pago (review de PR #226, punto 2). Solo un
 * 400/422 con una causa que reconocemos prueba que MP NO creó el pago y que repetirlo
 * falla igual: ahí se cierra el intento. Todo lo demás (408, 409 de idempotencia en
 * curso, 429, 5xx, red, o un 4xx que no entendemos) deja abierta la posibilidad de que el
 * pago exista, así que el intento queda en `creating` y el reintento reusa la key.
 */
export function classifyCreateError(info: MpErrorInfo): CreateErrorOutcome {
  if (info.status === 401 || info.status === 403) return { kind: "carrier_auth" };
  if (info.status === 400 || info.status === 422) {
    if (info.causeCodes.some((c) => INVALID_TOKEN_CAUSE_CODES.has(c))) {
      return { kind: "rejected", failureReason: "invalid_data" };
    }
    if (info.causeCodes.some((c) => PLATFORM_CAUSE_CODES.has(c))) {
      return { kind: "rejected", failureReason: "platform_error" };
    }
  }
  return { kind: "transient" };
}

/**
 * Traduce un pago de MP al estado del hold. Devuelve `null` ante un estado que no
 * conocemos (`refunded`, `charged_back`, `in_mediation`, ...): el caller deja la fila
 * como estaba. Convertirlo en `rejected` sacaría al hold del índice de holds vivos y
 * habilitaría una segunda reserva sobre fondos que siguen retenidos.
 *
 * Exportada para el webhook (MOVO-268): un pago que cambió por su cuenta en MP se
 * traduce igual que la respuesta de crear, consultar o liberar.
 */
export function holdUpdateFromPayment(
  payment: PaymentSnapshot,
  current: Hold | null,
  now: Date,
  holdValidityDays: number
): HoldUpdate | null {
  const statusDetail = payment.status_detail ?? null;
  const mpPaymentId = payment.id !== undefined ? String(payment.id) : null;
  const expiresAt = current?.expiresAt ?? new Date(now.getTime() + holdValidityDays * DAY_MS);
  // MOVO-302: marca y últimos 4 de la tarjeta, siempre que MP los traiga. Pasa por acá todo lo
  // que lee un pago (crear, consultar, adoptar, webhook), así la fila se completa donde sea que
  // MP los informe primero.
  const card = cardFromPayment(payment);
  switch (payment.status) {
    case "authorized":
      return { status: "authorized", statusDetail, failureReason: null, mpPaymentId, expiresAt, ...card };
    case "in_process":
    case "pending":
      return { status: "in_process", statusDetail, failureReason: null, mpPaymentId, expiresAt, ...card };
    case "approved":
      // Con `capture: false` no debería pasar; si pasa, la plata ya se cobró.
      return { status: "captured", statusDetail, failureReason: null, mpPaymentId, expiresAt: null, ...card };
    case "cancelled":
      return { status: "cancelled", statusDetail, failureReason: null, mpPaymentId, expiresAt: null, ...card };
    case "rejected":
      return {
        status: "rejected",
        statusDetail,
        failureReason: failureReasonFromStatusDetail(statusDetail, { savedCard: current?.savedCardId != null }),
        mpPaymentId,
        expiresAt: null,
        ...card,
      };
    default:
      return null;
  }
}

const roundArs = (value: number): number => Math.round(value * 100) / 100;

/** Centavos exactos y positivos: no se redondea en silencio un monto con más precisión. */
export function assertValidAmount(amountArs: number): void {
  const cents = amountArs * 100;
  if (!Number.isFinite(amountArs) || amountArs < 0.01 || Math.abs(cents - Math.round(cents)) > 1e-6) {
    throw new ApiError(400, "VALIDATION_FAILED", "amountArs tiene que ser un monto positivo con hasta 2 decimales");
  }
}

/**
 * Huella del cuerpo del pedido de un intento. Un reintento con la misma idempotency key
 * solo es seguro si el cuerpo coincide: con otro token, pagador o tarjeta guardada MP
 * reproduce el pago original (cobrado a la primera tarjeta) o responde un 4xx de mismatch.
 * Se guarda el hash, nunca el token ni el CVV. `savedCardId` (MOVO-282) solo entra cuando
 * viene, así la huella de un intento con tarjeta completa no cambia respecto de antes.
 */
function requestFingerprint(input: CreateHoldRequest): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        input.cardToken,
        input.payerEmail.toLowerCase(),
        input.paymentMethodId ?? "",
        ...(input.savedCardId ? [input.savedCardId] : []),
      ])
    )
    .digest("hex");
}

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
    baseAmountArs: hold.baseAmountArs.toNumber(),
    commissionArs: hold.commissionArs.toNumber(),
    debtOffsetArs: hold.debtOffsetArs.toNumber(),
    debtSurchargeArs: hold.debtSurchargeArs.toNumber(),
    status: hold.status,
    statusDetail: hold.statusDetail,
    failureReason: hold.failureReason,
    expiresAt: hold.expiresAt?.toISOString() ?? null,
    createdAt: hold.createdAt.toISOString(),
    updatedAt: hold.updatedAt.toISOString(),
  };
}

/** MOVO-211: `toHoldResponse` + la tarjeta del intento, solo para la consulta por envío (ver `HoldDetailResponse`). */
function toHoldDetailResponse(hold: Hold): HoldDetailResponse {
  return { ...toHoldResponse(hold), wasAuthorized: hold.wasAuthorized, cardBrand: hold.cardBrand, cardLast4: hold.cardLast4 };
}

export interface HoldServiceDeps {
  /** `MP_HOLD_VALIDITY_DAYS`: cuánto se espera que MP sostenga la reserva (AC4). */
  holdValidityDays: number;
  /** MOVO-311 (`DEBT_COLLECTION_MAX_RATE`): tope de la deuda que se cobra en un hold, sobre el precio. */
  debtCollectionMaxRate: number;
  /** MOVO-311: saldo cobrable de la cuenta corriente de un usuario (positivo = debe), para las vistas previas. */
  ledgerBalance: (userId: string) => Promise<number>;
  holds: HoldRepository;
  accounts: CarrierMpAccountRepository;
  mercadoPago: MercadoPagoClient;
  /** MOVO-282: resuelve la tarjeta guardada y el customer del emisor para pagar con `payer: customer`. */
  savedCards: Pick<SavedCardRepository, "findLive" | "findCustomer">;
  log: FastifyBaseLogger;
  now?: () => Date;
}

export interface CreateHoldResult {
  hold: HoldResponse;
  /** `true` si no se le pegó a MP para crear: el envío ya tenía un hold vigente. */
  replayed: boolean;
}

interface LinkedCarrier {
  mpUserId: string;
  accessToken: string;
  publicKey: string;
}

/**
 * MOVO-209: crea, consulta y libera la reserva de fondos de un envío. Único camino de
 * `svc-shipments` (dueño de la saga, MOVO-210) hacia los holds.
 *
 * **Idempotencia (AC6).** Hay una fila por intento (`shipmentId` + `attempt`) y la
 * `X-Idempotency-Key` es `movo-hold-<shipmentId>-<attempt>`:
 * - un hold vivo del envío se devuelve tal cual, sin llamar a MP ni exigir la cuenta
 *   vinculada (el transportista pudo desvincularse después);
 * - un intento que quedó en `creating` (respuesta perdida, timeout) se reintenta con la
 *   MISMA key si el cuerpo coincide (`requestFingerprint`), así MP devuelve el pago ya
 *   creado en vez de crear otro;
 * - si el cuerpo cambió, antes de abrir otro intento se busca el pago en MP por
 *   `external_reference`: si existe se lo adopta, si no se cierra el intento viejo;
 * - solo tras un rechazo o una liberación el intento siguiente usa otra key.
 * Además un índice único parcial en la base impide dos holds vivos por envío aunque dos
 * requests lleguen a la vez.
 */
export function createHoldService(deps: HoldServiceDeps) {
  const { holds, accounts, mercadoPago, savedCards, log } = deps;
  const now = deps.now ?? (() => new Date());

  const idempotencyKey = (shipmentId: string, attempt: number) => `movo-hold-${shipmentId}-${attempt}`;

  /** El transportista tiene que tener la cuenta vigente (no desvinculada, revocada ni vencida). */
  async function requireLinkedCarrier(carrierId: string): Promise<LinkedCarrier> {
    const credentials = await accounts.findActiveCredentials(carrierId, now());
    if (!credentials) {
      throw new ApiError(
        409,
        "CARRIER_MP_ACCOUNT_NOT_LINKED",
        "El transportista no tiene una cuenta de Mercado Pago vinculada y vigente"
      );
    }
    return credentials;
  }

  /**
   * Quién figura como pagador del pago (MOVO-282, ADR-039). Con `savedCardId` el pagador es el
   * customer de la tarjeta guardada en la cuenta de Movo (con `payer: { email }` MP responde 2002
   * "Customer not found"); sin él, el email del emisor de siempre. La tarjeta tiene que ser de
   * `payerUserId` y estar viva: ante cualquier otra cosa se responde el mismo 404, sin revelar si
   * la tarjeta existe. El `customer_id` ni el `card_id` salen de acá: ni a la respuesta ni al log.
   */
  async function resolvePayer(input: CreateHoldRequest): Promise<{ type?: string; id?: string; email?: string }> {
    if (!input.savedCardId) return { email: input.payerEmail };
    const [card, customer] = await Promise.all([
      savedCards.findLive(input.payerUserId, input.savedCardId),
      savedCards.findCustomer(input.payerUserId),
    ]);
    if (!card || !customer) throw new ApiError(404, "SAVED_CARD_NOT_FOUND", "Tarjeta no encontrada.");
    return { type: "customer", id: customer.mpCustomerId };
  }

  /**
   * Mismo transportista y mismo precio acordado. MOVO-311: se compara el precio (`baseAmountArs`) y no el
   * monto cobrado, que puede llevar el recargo por la deuda del emisor; `svc-shipments` siempre manda el precio.
   */
  function sameTerms(hold: Hold, carrierId: string, priceArs: number): boolean {
    return hold.carrierId === carrierId && hold.baseAmountArs.toNumber() === priceArs;
  }

  /** MOVO-311: montos del intento con la deuda que se puede cobrar a cada parte. */
  function planFor(priceArs: number) {
    return (balances: { carrierBalanceArs: number; payerBalanceArs: number }) =>
      computeDebtCollection({ priceArs, ...balances, capRate: deps.debtCollectionMaxRate });
  }

  /**
   * Traduce un pago de MP al estado del hold (`holdUpdateFromPayment`). Ante un estado
   * que no conocemos deja la fila como estaba y lo loguea.
   */
  function mapPayment(payment: PaymentSnapshot, current: Hold | null): HoldUpdate | null {
    const patch = holdUpdateFromPayment(payment, current, now(), deps.holdValidityDays);
    if (!patch) {
      log.error(
        {
          holdId: current?.id,
          mpPaymentId: payment.id !== undefined ? String(payment.id) : null,
          mpStatus: payment.status,
          mpStatusDetail: payment.status_detail ?? null,
        },
        "estado de pago de MP desconocido, el hold queda sin cambios"
      );
    }
    return patch;
  }

  /**
   * Busca en MP el pago vivo de un intento que quedó en `creating` (punto 5 y 6 de la
   * review). `unverifiable` = no hay credenciales para preguntarle a MP.
   */
  async function findLivePayment(
    hold: Hold
  ): Promise<{ kind: "found"; payment: PaymentSnapshot } | { kind: "none" } | { kind: "unverifiable" }> {
    const credentials = await accounts.findCredentials(hold.carrierId);
    if (!credentials) return { kind: "unverifiable" };
    try {
      const payments = await mercadoPago.searchPaymentsByExternalReference(
        credentials.accessToken,
        hold.shipmentId
      );
      const live = payments.find((p) => p.status !== undefined && LIVE_MP_STATUSES.has(p.status));
      return live ? { kind: "found", payment: live } : { kind: "none" };
    } catch (error) {
      log.error(
        { shipmentId: hold.shipmentId, holdId: hold.id, reason: readMpError(error).message },
        "falló la búsqueda del pago en MP"
      );
      throw new ApiError(502, "PAYMENT_PROVIDER_ERROR", "No se pudo consultar a Mercado Pago, reintentá");
    }
  }

  /** MOVO-311: el emisor confirmó un total y ya no es el que corresponde cobrar. */
  function amountChanged(totalArs: number): ApiError {
    return new ApiError(
      409,
      "HOLD_AMOUNT_CHANGED",
      "El monto a pagar cambió desde que lo confirmaste: revisalo y volvé a confirmar",
      { totalArs }
    );
  }

  /** Un `creating` al que MP ya le tiene un pago vivo: la fila pasa a reflejarlo. */
  async function adopt(hold: Hold, payment: PaymentSnapshot): Promise<Hold> {
    const patch = mapPayment(payment, hold);
    if (!patch) return hold;
    log.warn(
      { shipmentId: hold.shipmentId, holdId: hold.id, mpPaymentId: patch.mpPaymentId },
      "hold en creating adoptado desde MP"
    );
    return holds.update(hold.id, patch);
  }

  async function closeAttempt(hold: Hold, statusDetail: string): Promise<Hold> {
    return holds.update(hold.id, { status: "rejected", statusDetail, failureReason: "platform_error" });
  }

  /**
   * Decide qué intento procesar. `replay` = ya hay un hold vigente, no se llama a MP para
   * crear; `process` = hay que (re)intentar la llamada con la key de ese intento. El
   * transportista se carga de forma perezosa: solo hace falta para abrir un intento
   * nuevo, no para devolver uno vigente.
   */
  async function resolveAttempt(
    input: CreateHoldRequest,
    priceArs: number,
    fingerprint: string,
    loadCarrier: () => Promise<LinkedCarrier>
  ): Promise<{ kind: "replay" | "process"; hold: Hold }> {
    const savedCardId = input.savedCardId ?? null;
    for (let tries = 0; tries < 3; tries += 1) {
      let latest = await holds.findLatestByShipment(input.shipmentId);

      // El pagador de un hold vigente (o de un intento sin respuesta) no cambia: `payerId` no entra al
      // fingerprint ni a `sameTerms`, así que sin este chequeo un reintento con otro `payerUserId`
      // reusaría la fila y el pago quedaría atribuido al primer emisor (MOVO-302, review de PR #255).
      // Un hold anterior a MOVO-302 no tiene `payerId` y no se compara.
      if (latest && !CLOSED_HOLD_STATUSES.includes(latest.status) && latest.payerId && latest.payerId !== input.payerUserId) {
        throw new ApiError(
          409,
          "HOLD_CONFLICT",
          "El envío ya tiene un hold vigente de otro pagador: liberalo antes de crear otro"
        );
      }

      if (latest && latest.status === "creating") {
        const sameBody = sameTerms(latest, input.carrierId, priceArs) && latest.requestFingerprint === fingerprint;
        if (sameBody) {
          // El intento ya fijó sus montos: si el emisor confirmó otro total, no se reintenta con la misma key.
          if (input.expectedTotalArs != null && roundArs(input.expectedTotalArs) !== latest.amountArs.toNumber()) {
            throw amountChanged(latest.amountArs.toNumber());
          }
          return { kind: "process", hold: latest };
        }

        // El cuerpo cambió (otra tarjeta, otro pagador, otro monto u otro transportista)
        // sobre un intento sin respuesta: no se puede reusar la key. Antes de abrir otro
        // intento hay que saber si MP llegó a crear el pago.
        const lookup = await findLivePayment(latest);
        if (lookup.kind === "found") {
          latest = await adopt(latest, lookup.payment);
        } else {
          if (lookup.kind === "unverifiable") {
            // Sin credenciales del transportista anterior no se puede preguntar. Si MP
            // creó el pago, queda un hold huérfano que vence solo (ver CLAUDE.md).
            log.error(
              { shipmentId: input.shipmentId, holdId: latest.id, attempt: latest.attempt },
              "intento de hold sin resolver reemplazado sin poder consultar a MP"
            );
          }
          latest = await closeAttempt(latest, "superseded");
        }
      }

      if (latest && !CLOSED_HOLD_STATUSES.includes(latest.status)) {
        if (sameTerms(latest, input.carrierId, priceArs)) return { kind: "replay", hold: latest };
        throw new ApiError(
          409,
          "HOLD_CONFLICT",
          "El envío ya tiene un hold vigente con otro transportista o monto: liberalo antes de crear otro"
        );
      }

      try {
        const carrier = await loadCarrier();
        const created = await holds.createAttempt({
          shipmentId: input.shipmentId,
          attempt: (latest?.attempt ?? 0) + 1,
          carrierId: input.carrierId,
          collectorId: carrier.mpUserId,
          plan: planFor(priceArs),
          requestFingerprint: fingerprint,
          savedCardId,
          // MOVO-302: el emisor queda en el hold para el historial; no entra al fingerprint ni
          // a `HoldResponse` (el contrato interno de holds no lo expone).
          payerId: input.payerUserId,
          expectedAmountArs: input.expectedTotalArs == null ? null : roundArs(input.expectedTotalArs),
        });
        return { kind: "process", hold: created };
      } catch (error) {
        if (error instanceof HoldAmountChangedError) throw amountChanged(error.amounts.amountArs);
        // Otro request ganó la carrera: se vuelve a leer y se decide con lo que dejó.
        if (!(error instanceof HoldAttemptConflictError)) throw error;
      }
    }
    throw new ApiError(409, "HOLD_CONFLICT", "No se pudo resolver el intento de hold por concurrencia, reintentá");
  }

  /** Persiste el pago devuelto por MP; con un estado desconocido deja el intento en `creating`. */
  async function settleCreated(hold: Hold, payment: PaymentSnapshot): Promise<HoldResponse> {
    const patch = mapPayment(payment, hold);
    if (!patch) {
      await holds.update(hold.id, {
        mpPaymentId: payment.id !== undefined ? String(payment.id) : null,
        statusDetail: payment.status_detail ?? null,
        // Un estado que no conocemos igual trae la tarjeta, y nada lo vuelve a sincronizar después.
        ...cardFromPayment(payment),
      });
      throw new ApiError(
        502,
        "PAYMENT_PROVIDER_ERROR",
        "Mercado Pago devolvió un estado de pago inesperado: el hold quedó pendiente de revisión"
      );
    }
    const updated = await holds.update(hold.id, patch);
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
    return toHoldResponse(updated);
  }

  return {
    /** AC1: lo que el mobile necesita para tokenizar la tarjeta y mostrar el monto. */
    async getCheckoutData(input: HoldCheckoutDataRequest): Promise<HoldCheckoutDataResponse> {
      assertValidAmount(input.amountArs);
      const priceArs = roundArs(input.amountArs);
      const [carrier, carrierBalanceArs, payerBalanceArs] = await Promise.all([
        requireLinkedCarrier(input.carrierId),
        deps.ledgerBalance(input.carrierId),
        // Misma persona en los dos roles (shipments no lo permite): su saldo se cobra una sola vez, como cobrador.
        input.payerUserId && input.payerUserId !== input.carrierId
          ? deps.ledgerBalance(input.payerUserId)
          : Promise.resolve(0),
      ]);
      // MOVO-311: vista previa, sin reservar nada. El hold vuelve a calcularla con los usuarios bloqueados,
      // así que si la deuda cambió en el medio el monto cobrado puede diferir (lo devuelve el hold).
      const amounts = planFor(priceArs)({ carrierBalanceArs, payerBalanceArs });
      return {
        shipmentId: input.shipmentId,
        publicKey: carrier.publicKey,
        amountArs: amounts.amountArs,
        applicationFeeArs: amounts.applicationFeeArs,
        baseAmountArs: amounts.baseAmountArs,
        debtOffsetArs: amounts.debtOffsetArs,
        debtSurchargeArs: amounts.debtSurchargeArs,
        payerEmail: input.payerEmail,
      };
    },

    /**
     * MOVO-311: cuánto de su deuda se le descontaría a un transportista en cada uno de estos precios
     * (para el "Recibís aprox." de sus ofertas). El saldo ya descuenta lo reservado por holds en curso.
     */
    async previewCarrierDebt(userId: string, amountsArs: number[]): Promise<DebtCollectionPreviewResponse> {
      const balance = await deps.ledgerBalance(userId);
      return {
        pendingBalanceArs: Math.max(0, balance),
        debtOffsetsArs: amountsArs.map(
          (priceArs) => planFor(roundArs(priceArs))({ carrierBalanceArs: balance, payerBalanceArs: 0 }).debtOffsetArs
        ),
      };
    },

    /** AC2/AC3/AC5/AC6. Un rechazo de la tarjeta NO es un error HTTP: vuelve como hold `rejected`. */
    async create(input: CreateHoldRequest): Promise<CreateHoldResult> {
      assertValidAmount(input.amountArs);
      // `amountArs` es el precio acordado (`Offer.priceOffered`, el bruto que ve el emisor). Lo que se cobra
      // sale del intento: la comisión de `@movo/shared` más la deuda de cada parte (MOVO-311, `planFor`).
      const priceArs = roundArs(input.amountArs);

      // Antes de abrir un intento: una tarjeta ajena o dada de baja no crea ninguna fila.
      const payer = await resolvePayer(input);

      let carrierPromise: Promise<LinkedCarrier> | undefined;
      const loadCarrier = () => (carrierPromise ??= requireLinkedCarrier(input.carrierId));

      const { kind, hold } = await resolveAttempt(input, priceArs, requestFingerprint(input), loadCarrier);
      if (kind === "replay") {
        log.info(
          { shipmentId: hold.shipmentId, holdId: hold.id, status: hold.status },
          "hold ya vigente, no se vuelve a crear"
        );
        return { hold: toHoldResponse(hold), replayed: true };
      }

      const carrier = await loadCarrier();
      const key = idempotencyKey(hold.shipmentId, hold.attempt);
      // Los montos del intento, no recalculados: un reintento con la misma key tiene que mandar el mismo cuerpo.
      const amountArs = hold.amountArs.toNumber();
      const applicationFeeArs = hold.applicationFeeArs.toNumber();
      // AC9: ni el card_token ni el email del pagador (ni el customer/card id de MP) se loguean.
      log.info(
        {
          shipmentId: hold.shipmentId,
          holdId: hold.id,
          attempt: hold.attempt,
          amountArs,
          applicationFeeArs,
          debtOffsetArs: hold.debtOffsetArs.toNumber(),
          debtSurchargeArs: hold.debtSurchargeArs.toNumber(),
        },
        "creando hold en MP"
      );

      let payment: PaymentSnapshot;
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
            // Para que MOVO-268 y la recuperación de un `creating` puedan reconciliar un
            // pago contra el envío.
            external_reference: hold.shipmentId,
            payer,
            application_fee: applicationFeeArs,
          },
          key
        );
      } catch (error) {
        const info = readMpError(error);
        const outcome = classifyCreateError(info);
        const context = {
          shipmentId: hold.shipmentId,
          holdId: hold.id,
          mpHttpStatus: info.status,
          mpCauseCodes: info.causeCodes,
        };
        if (outcome.kind === "rejected") {
          // MP rechazó el REQUEST por una causa conocida: no se creó pago y repetirlo
          // falla igual. El intento termina y el siguiente usa otra key.
          log.warn(context, "MP rechazó la creación del hold");
          const rejected = await holds.update(hold.id, {
            status: "rejected",
            statusDetail: info.causeCodes[0] ? `mp_error_${info.causeCodes[0]}` : `mp_http_${info.status}`,
            failureReason: outcome.failureReason,
          });
          return { hold: toHoldResponse(rejected), replayed: false };
        }
        if (outcome.kind === "carrier_auth") {
          // El token del transportista ya no sirve: MP no procesó el pedido. El intento
          // sigue en `creating` y se reintenta con la misma key cuando re-vincule.
          log.warn(context, "MP rechazó el token del transportista al crear el hold");
          throw new ApiError(
            409,
            "CARRIER_MP_ACCOUNT_NOT_LINKED",
            "Mercado Pago rechazó las credenciales del transportista: tiene que volver a vincular su cuenta"
          );
        }
        // Timeout, red, 408/409/429, 5xx o un 4xx que no entendemos: no se sabe si MP
        // creó el pago. El intento queda en `creating` y el reintento reusa la key.
        log.error({ ...context, reason: info.message }, "MP no respondió al crear el hold");
        throw new ApiError(502, "PAYMENT_PROVIDER_ERROR", "Mercado Pago no respondió: reintentá con la misma tarjeta");
      }

      return { hold: await settleCreated(hold, payment), replayed: false };
    },

    /**
     * AC7. Por defecto devuelve lo persistido. Con `sync` consulta a MP y actualiza la
     * fila (hasta que MOVO-268 reciba los webhooks, es la forma de ver un hold que MP
     * cambió por su cuenta, o de resolver un intento que quedó en `creating`).
     */
    async getByShipment(shipmentId: string, opts: { sync?: boolean } = {}): Promise<HoldDetailResponse> {
      let hold = await holds.findLatestByShipment(shipmentId);
      if (!hold) throw new ApiError(404, "HOLD_NOT_FOUND", "El envío no tiene ningún hold");
      if (!opts.sync) return toHoldDetailResponse(hold);

      if (hold.status === "creating") {
        hold = await reconcileCreating(hold);
      } else if (hold.mpPaymentId && (hold.status === "authorized" || hold.status === "in_process")) {
        const credentials = await accounts.findCredentials(hold.carrierId);
        if (!credentials) {
          log.warn({ shipmentId, holdId: hold.id }, "sin credenciales del transportista para sincronizar el hold");
        } else {
          let payment: PaymentSnapshot;
          try {
            payment = await mercadoPago.getPayment(credentials.accessToken, hold.mpPaymentId);
          } catch (error) {
            log.error(
              { shipmentId, holdId: hold.id, reason: readMpError(error).message },
              "falló la consulta del hold a MP"
            );
            throw new ApiError(502, "PAYMENT_PROVIDER_ERROR", "No se pudo consultar el estado a Mercado Pago");
          }
          const patch = mapPayment(payment, hold);
          if (patch) hold = await holds.update(hold.id, patch);
        }
      } else if (
        hold.mpPaymentId &&
        hold.cardLast4 == null &&
        hold.cardBrand == null &&
        (hold.status === "captured" || hold.status === "cancelled")
      ) {
        // MOVO-302: un hold que ya salió de authorized/in_process no vuelve a leerse nunca; si quedó
        // sin tarjeta (adoptado por búsqueda, o un create que vino sin `card`), este es el único camino
        // que la completa. No toca el estado: solo agrega lo que falta. Solo se intenta si no hay ni
        // marca ni últimos 4: un pago sin tarjeta (por ejemplo con dinero en cuenta) queda con la
        // marca guardada y no vuelve a consultar a MP en cada `?sync=true` (review de PR #255).
        hold = await completeCardFromMp(hold);
      }
      return toHoldDetailResponse(hold);
    },

    /**
     * AC8: libera sin capturar. Idempotente: un hold ya cancelado, o un intento rechazado
     * (que nunca retuvo fondos), se devuelve tal cual. Un hold capturado no se libera: eso
     * es un reembolso. Un intento en `creating` se reconcilia primero contra MP.
     *
     * Limitación conocida: cancelar necesita el access_token del transportista (MP solo
     * deja cancelar al cobrador). Si desvinculó (se borran los tokens) o MP los revocó, el
     * hold no se puede liberar desde acá y vence solo (~5-7 días); ver CLAUDE.md.
     */
    async release(shipmentId: string, expectedCarrierId?: string, expectedHoldId?: string): Promise<HoldResponse> {
      let hold = await holds.findLatestByShipment(shipmentId);
      if (!hold) throw new ApiError(404, "HOLD_NOT_FOUND", "El envío no tiene ningún hold");
      if ((expectedCarrierId && hold.carrierId !== expectedCarrierId) ||
          (expectedHoldId && hold.id !== expectedHoldId)) {
        throw new ApiError(409, "HOLD_CONFLICT", "El hold pertenece a otra asignación");
      }

      if (hold.status === "creating") hold = await reconcileCreating(hold);
      if (hold.status === "cancelled" || hold.status === "rejected") return toHoldResponse(hold);
      if (hold.status === "captured") {
        throw new ApiError(409, "HOLD_NOT_RELEASABLE", "El hold ya fue capturado: no se puede liberar");
      }
      if (hold.status === "creating" || !hold.mpPaymentId) {
        throw new ApiError(
          409,
          "HOLD_NOT_RELEASABLE",
          "El hold todavía no se confirmó con Mercado Pago: reintentá en unos minutos"
        );
      }

      const credentials = await accounts.findCredentials(hold.carrierId);
      if (!credentials) {
        log.error(
          { shipmentId, holdId: hold.id, mpPaymentId: hold.mpPaymentId, expiresAt: hold.expiresAt },
          "hold sin liberar: el transportista ya no tiene credenciales; vence solo en MP"
        );
        throw new ApiError(
          409,
          "CARRIER_MP_ACCOUNT_NOT_LINKED",
          "No hay credenciales vigentes del transportista para liberar el hold"
        );
      }

      let payment: PaymentSnapshot;
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
            const patch = mapPayment(current, hold);
            if (patch) return toHoldResponse(await holds.update(hold.id, patch));
          }
        } catch {
          // Se informa el error original de la cancelación.
        }
        log.error(
          { shipmentId, holdId: hold.id, mpHttpStatus: info.status, reason: info.message },
          "falló la liberación del hold"
        );
        if (info.status === 401 || info.status === 403) {
          throw new ApiError(
            409,
            "CARRIER_MP_ACCOUNT_NOT_LINKED",
            "Mercado Pago rechazó las credenciales del transportista: no se pudo liberar el hold"
          );
        }
        throw new ApiError(502, "PAYMENT_PROVIDER_ERROR", "No se pudo liberar el hold en Mercado Pago");
      }

      // Solo se informa liberado si MP confirma `cancelled`: cualquier otra cosa (estado
      // desconocido, o un pago que no se canceló) es un error, no un 200.
      const patch = mapPayment(payment, hold);
      if (!patch || patch.status !== "cancelled") {
        log.error(
          { shipmentId, holdId: hold.id, mpStatus: payment.status },
          "MP respondió la cancelación con un estado distinto de cancelled"
        );
        throw new ApiError(502, "PAYMENT_PROVIDER_ERROR", "Mercado Pago no confirmó la liberación del hold");
      }
      const updated = await holds.update(hold.id, patch);
      log.info(
        { shipmentId, holdId: updated.id, mpPaymentId: updated.mpPaymentId, status: updated.status },
        "hold liberado"
      );
      return toHoldResponse(updated);
    },
  };

  /**
   * MOVO-302: completa marca y últimos 4 de un hold ya capturado o cancelado leyendo el pago a MP.
   * Solo agrega lo que falta: no cambia el estado ni pisa una tarjeta ya guardada.
   *
   * Es un dato solo para el historial, así que es de mejor esfuerzo: si MP no responde se loguea y
   * se devuelve el hold como está, en vez de convertir un `?sync=true` que antes nunca llamaba a MP
   * en un 502 para `svc-shipments` (review de PR #255).
   */
  async function completeCardFromMp(hold: Hold): Promise<Hold> {
    const credentials = await accounts.findCredentials(hold.carrierId);
    if (!credentials || !hold.mpPaymentId) {
      log.warn({ shipmentId: hold.shipmentId, holdId: hold.id }, "sin credenciales para completar la tarjeta del hold");
      return hold;
    }
    let payment: PaymentSnapshot;
    try {
      payment = await mercadoPago.getPayment(credentials.accessToken, hold.mpPaymentId);
    } catch (error) {
      log.error(
        { shipmentId: hold.shipmentId, holdId: hold.id, reason: readMpError(error).message },
        "falló la consulta del pago a MP para completar la tarjeta, el hold queda como está"
      );
      return hold;
    }
    const missing = missingCardFields(hold, payment);
    return Object.keys(missing).length > 0 ? holds.update(hold.id, missing) : hold;
  }

  /**
   * Resuelve un intento en `creating` contra MP: si el pago existe se lo adopta; si MP no
   * lo tiene y el intento ya es viejo, se lo da por abandonado. Si es reciente o no se
   * puede consultar, queda como estaba (reintento con la misma key).
   */
  async function reconcileCreating(hold: Hold): Promise<Hold> {
    const lookup = await findLivePayment(hold);
    if (lookup.kind === "found") return adopt(hold, lookup.payment);
    const stale = now().getTime() - hold.createdAt.getTime() > STALE_CREATING_MS;
    if (lookup.kind === "none" && stale) {
      log.warn({ shipmentId: hold.shipmentId, holdId: hold.id }, "intento de hold abandonado: MP no tiene el pago");
      return closeAttempt(hold, "abandoned");
    }
    return hold;
  }
}

export type HoldService = ReturnType<typeof createHoldService>;
