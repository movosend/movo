import type { FastifyBaseLogger } from "fastify";
import {
  ApiError,
  CreateRefundRequest,
  CreateRefundResponse,
  REFUND_IDEMPOTENCY_KEY_MAX_LENGTH,
  REFUND_REASON_MAX_LENGTH,
  REFUND_REASON_MIN_LENGTH,
  RefundFailureReason,
  RefundResponse,
  RefundsResponse,
} from "@movo/shared";
import type { Prisma } from "../../generated/prisma/client";
import type { AlertNotifier } from "../../adapters/alert-notifier";
import type { MercadoPagoClient, RefundSnapshot } from "../../adapters/mercadopago-client";
import type { CarrierMpAccountRepository } from "../../repositories/carrier-mp-account-repository";
import {
  Refund,
  RefundAmountExceedsError,
  RefundIdempotencyConflictError,
  RefundRepository,
  refundableAmount,
} from "../../repositories/refund-repository";
import type { Settlement, SettlementRepository } from "../../repositories/settlement-repository";
import { fingerprintOf, type UserLedgerRepository } from "../../repositories/user-ledger-repository";
import { toMoney } from "../../utils/payment-fee";
import { assertValidAmount, readMpError } from "../holds/hold.service";
import { classifyRefundError } from "./refund-failure";

export interface RefundServiceDeps {
  refunds: RefundRepository;
  settlements: Pick<SettlementRepository, "findByShipment">;
  accounts: Pick<CarrierMpAccountRepository, "findCredentials">;
  mercadoPago: Pick<MercadoPagoClient, "refundPayment">;
  /** AC4: el fallback asienta la deuda del transportista en su cuenta corriente. */
  ledger: Pick<UserLedgerRepository, "insert">;
  /** Getter: `app.alerts` lo decora un plugin posterior (mismo criterio que el escalado de liquidaciones). */
  alerts: () => AlertNotifier;
  log: FastifyBaseLogger;
  now?: () => Date;
}

/**
 * Cuánto se confía en que MP todavía recuerde la key de un intento `processing` para reintentarlo sin riesgo. MP guarda
 * la idempotencia por tiempo limitado (se cree ~24 h, **sin confirmar en la doc**: revisar con el Paso 0): pasado ese
 * plazo, un reintento de un reembolso que MP sí había hecho lo repetiría. Margen conservador: la mitad.
 */
export const MP_IDEMPOTENCY_SAFE_WINDOW_MS = 12 * 60 * 60 * 1000;

/**
 * Mientras un pedido está hablando con MP su intento figura "en manos de alguien" (`last_error` en null y `updated_at`
 * reciente): otro reintento no lo toma hasta pasado este plazo, que cubre el peor caso de una llamada al SDK (~22 s).
 */
export const REFUND_IN_FLIGHT_LEASE_MS = 60_000;

/** Estados de MP de un reembolso que no se hizo ni se va a hacer. */
const MP_REFUND_DEAD_STATUSES = new Set(["rejected", "cancelled"]);
/** Estados de MP de un reembolso que sigue en curso: el intento queda `processing`. */
const MP_REFUND_PENDING_STATUSES = new Set(["in_process", "pending"]);

/** Solo campos del reembolso: nada de `source` (trae el nombre de quien lo inició) ni de la respuesta cruda. */
function sanitizeMpResponse(refund: RefundSnapshot): Prisma.InputJsonObject {
  const picked: Record<string, string | number> = {};
  for (const key of [
    "id",
    "payment_id",
    "amount",
    "status",
    "date_created",
    "refund_mode",
    "adjustment_amount",
    "amount_refunded_to_payer",
  ] as const) {
    const value = refund[key];
    if (typeof value === "string" || typeof value === "number") picked[key] = value;
  }
  return picked;
}

export function toRefundResponse(refund: Refund): RefundResponse {
  return {
    id: refund.id,
    settlementId: refund.settlementId,
    shipmentId: refund.shipmentId,
    attempt: refund.attempt,
    amountArs: refund.amountArs.toNumber(),
    reason: refund.reason,
    status: refund.status,
    failureReason: (refund.failureReason as RefundFailureReason | null) ?? null,
    mpRefundId: refund.mpRefundId,
    ledgerEntryId: refund.ledgerEntryId,
    createdAt: refund.createdAt.toISOString(),
    updatedAt: refund.updatedAt.toISOString(),
  };
}

/**
 * MOVO-336: devuelve plata de un pago ya capturado. Único camino de `svc-payments` hacia un reembolso; lo llama
 * quien resuelve una disputa (MOVO-337).
 *
 * **Solo sobre una liquidación `credited`** (`409 SETTLEMENT_NOT_REFUNDABLE`): antes de capturar no hay nada que
 * devolver, el hold se libera (MOVO-209).
 *
 * **Monto.** Sin `amountArs` es el total de lo reembolsable; con monto, `422 REFUND_AMOUNT_EXCEEDS_REFUNDABLE` si
 * supera lo capturado menos lo ya reembolsado. `processing`, `succeeded` y `fallback_to_ledger` cuentan; `failed` no.
 *
 * **Idempotencia.** La `idempotencyKey` es del llamador: con ella, un reintento devuelve el intento vivo en vez de
 * abrir otro (la reserva es atómica por liquidación, ver `RefundRepository.reserve`). Cada intento nuevo usa
 * `movo-refund-<settlementId>-<n>` hacia MP, así el reintento de uno `processing` (respuesta perdida) reusa la key y
 * no devuelve dos veces, y el de uno `failed` no hereda el rechazo que MP cacheó para la anterior.
 *
 * **Saldo insuficiente (AC4).** MP no se vuelve a llamar: el monto queda como deuda del transportista en su cuenta
 * corriente (`manual_adjustment`, se cobra como cualquier deuda, MOVO-311/312/313), el intento pasa a
 * `fallback_to_ledger` y se alerta al equipo, porque **el emisor todavía no recibió su plata**: devolvérsela es un
 * caso manual (el Paso 0 del ticket no encontró una forma automática; ver `HISTORIAL.md`).
 *
 * **Otras fallas (AC5).** Un rechazo de MP o credenciales inutilizables dejan el intento `failed`, consultable y con
 * alerta, y la llamada responde error. Una falla de red o 5xx no prueba que MP no haya reembolsado: el intento queda
 * `processing`, también con alerta, y el reintento con la misma key lo retoma.
 */
export function createRefundService(deps: RefundServiceDeps) {
  const { refunds, settlements, accounts, mercadoPago, ledger, log } = deps;
  const now = deps.now ?? (() => new Date());

  async function alert(kind: string, message: string, refund: Refund, extra: Record<string, string | number | null> = {}) {
    try {
      await deps.alerts().send({
        kind,
        message,
        context: {
          shipmentId: refund.shipmentId,
          settlementId: refund.settlementId,
          refundId: refund.id,
          attempt: refund.attempt,
          amountArs: refund.amountArs.toNumber(),
          mpPaymentId: refund.mpPaymentId,
          ...extra,
        },
      });
    } catch (error) {
      // Una alerta nunca rompe el reembolso: ya quedó en el log y el intento es consultable.
      log.error({ err: error, kind, refundId: refund.id }, "no se pudo enviar la alerta del reembolso");
    }
  }

  /** Cierra el intento como `failed`, avisa y devuelve el error que ve el llamador. */
  async function fail(
    refund: Refund,
    reason: RefundFailureReason,
    error: ApiError,
    lastError: string,
    context: Record<string, string | number | null> = {},
    alertAs: { kind: string; message: string } = { kind: "refund_failed", message: "Un reembolso a favor del emisor falló y no se hizo" }
  ): Promise<never> {
    const applied = await refunds.updateIfStatus(refund.id, "processing", {
      status: "failed",
      failureReason: reason,
      lastError: lastError.slice(0, 500),
      completedAt: now(),
    });
    log.error({ shipmentId: refund.shipmentId, refundId: refund.id, reason, applied, ...context }, "reembolso fallido");
    await alert(alertAs.kind, alertAs.message, refund, { reason, lastError: lastError.slice(0, 200), ...context });
    throw error;
  }

  /**
   * Un intento que ya pudo haber llegado a MP (se está reintentando uno `processing`) no se da por `failed` por algo que
   * pasó ANTES de hablar con MP --credenciales vencidas, un 401--: MP pudo haber hecho el reembolso en el intento
   * ambiguo, y un `failed` abriría el intento siguiente con otra key y lo repetiría. Sigue `processing` (con
   * `last_error`, que lo deja reintentable), se alerta y el llamador recibe el error.
   */
  async function keepUnconfirmed(refund: Refund, error: ApiError, lastError: string, context: Record<string, string | number | null> = {}): Promise<never> {
    await refunds.updateIfStatus(refund.id, "processing", { lastError: lastError.slice(0, 500) });
    log.error({ shipmentId: refund.shipmentId, refundId: refund.id, ...context }, "reintento de un reembolso sin confirmar: queda en curso");
    await alert(
      "refund_unconfirmed",
      "No se pudo reintentar un reembolso sin confirmar: queda en curso (pudo haberse hecho en MP), no se da por fallido",
      refund,
      { lastError: lastError.slice(0, 200), ...context }
    );
    throw error;
  }

  /** AC4: el transportista no tiene saldo. La deuda va a su cuenta corriente y el emisor queda como caso manual. */
  async function fallbackToLedger(refund: Refund, lastError: string): Promise<Refund> {
    // TODO(MOVO-336 Paso 0): se asienta el monto BRUTO reembolsado al emisor, pero el transportista cobró menos (neto de
    // la comisión de Movo y la de MP). Si MP no devuelve el `application_fee` en el reembolso, esto lo hace pagar de
    // más; si lo devuelve, de menos. Ajustar con lo que muestre `refund.sandbox.test.ts` (escenarios A y B).
    const amount = refund.amountArs;
    const reason = `Reembolso al emisor sin saldo en Mercado Pago (envío ${refund.shipmentId}): ${refund.reason}`.slice(0, REFUND_REASON_MAX_LENGTH);
    // Positivo = el transportista debe. Idempotente por la key: un reintento no suma la deuda dos veces.
    const { entry } = await ledger.insert({
      userId: refund.carrierId,
      roleAtOrigin: "carrier",
      type: "manual_adjustment",
      amountArs: amount,
      status: "pending",
      shipmentId: refund.shipmentId,
      holdId: refund.holdId,
      paymentId: refund.mpPaymentId,
      reason,
      adminId: refund.adminId,
      idempotencyKey: `movo-refund-ledger-${refund.id}`,
      requestFingerprint: fingerprintOf({
        userId: refund.carrierId,
        type: "manual_adjustment",
        amount: amount.toFixed(2),
        reason,
        adminId: refund.adminId,
        shipmentId: refund.shipmentId,
      }),
    });
    await refunds.updateIfStatus(refund.id, "processing", {
      status: "fallback_to_ledger",
      failureReason: "insufficient_balance",
      lastError: lastError.slice(0, 500),
      ledgerEntryId: entry.id,
      completedAt: now(),
    });
    const settled = (await refunds.findById(refund.id)) ?? refund;
    log.error(
      { shipmentId: refund.shipmentId, refundId: refund.id, ledgerEntryId: entry.id },
      "reembolso sin saldo del transportista: deuda asentada en su cuenta corriente, el emisor queda como caso manual"
    );
    await alert(
      "refund_fallback_to_ledger",
      "El transportista no tiene saldo en MP para un reembolso: su deuda quedó en la cuenta corriente y hay que devolverle la plata al emisor a mano",
      settled,
      { carrierId: refund.carrierId, ledgerEntryId: entry.id }
    );
    return settled;
  }

  /**
   * Pide el reembolso a MP para un intento `processing` y deja el resultado persistido. `resumed` es un intento que ya
   * existía (no lo creó este pedido): pudo haber llegado a MP, así que no se cierra como `failed` por lo que pasó antes.
   */
  async function drive(refund: Refund, resumed: boolean): Promise<Refund> {
    const credentials = await accounts.findCredentials(refund.carrierId);
    if (credentials === null || (credentials.tokenExpiresAt !== null && credentials.tokenExpiresAt <= now())) {
      const noCredentials = new ApiError(
        409,
        "CARRIER_MP_ACCOUNT_NOT_LINKED",
        "No hay credenciales vigentes del transportista para reembolsar el pago"
      );
      const cause = credentials ? "token de MP del transportista vencido" : "sin credenciales de MP del transportista";
      return resumed
        ? keepUnconfirmed(refund, noCredentials, cause)
        : fail(refund, "carrier_account_unavailable", noCredentials, cause);
    }

    let snapshot: RefundSnapshot;
    try {
      snapshot = await mercadoPago.refundPayment(credentials.accessToken, refund.mpPaymentId, {
        idempotencyKey: refund.mpIdempotencyKey,
        amount: refund.amountArs.toNumber(),
      });
    } catch (error) {
      const info = readMpError(error);
      const context = { mpHttpStatus: info.status ?? null, mpCauseCodes: info.causeCodes.join(",") || null };
      switch (classifyRefundError(info)) {
        case "insufficient_balance":
          return fallbackToLedger(refund, `${info.message} (HTTP ${info.status ?? "?"})`);
        case "auth": {
          const rejected = new ApiError(409, "CARRIER_MP_ACCOUNT_NOT_LINKED", "Mercado Pago rechazó las credenciales del transportista: no se pudo reembolsar");
          return resumed
            ? keepUnconfirmed(refund, rejected, info.message, context)
            : fail(refund, "carrier_account_unavailable", rejected, info.message, context);
        }
        case "transient":
          // No sabemos si MP lo hizo: sigue `processing` y el reintento reusa la key (nunca `failed`, ver arriba).
          return keepUnconfirmed(
            refund,
            new ApiError(502, "PAYMENT_PROVIDER_ERROR", "No se pudo confirmar el reembolso con Mercado Pago: reintentá"),
            info.message,
            context
          );
        case "rejected":
          // Un 4xx que no se reconoce como falta de saldo. Mientras `INSUFFICIENT_BALANCE_CAUSES` esté vacío (Paso 0
          // pendiente) puede SER falta de saldo con otro texto: sin la deuda asentada. Por eso la alerta es aparte y
          // trae el mensaje y las causas de MP para poder reconocerlo.
          return fail(
            refund,
            "provider_rejected",
            new ApiError(502, "PAYMENT_PROVIDER_ERROR", "Mercado Pago rechazó el reembolso"),
            info.message,
            context,
            {
              kind: "refund_rejected_unrecognized",
              message:
                "Mercado Pago rechazó un reembolso por una causa no reconocida (puede ser saldo insuficiente: Paso 0 de MOVO-336 pendiente). Si lo es, el transportista no quedó en deuda y el emisor no cobró",
            }
          );
      }
    }

    const mpStatus = snapshot.status ?? null;
    const patch = {
      mpRefundId: snapshot.id === undefined ? null : String(snapshot.id),
      mpResponse: sanitizeMpResponse(snapshot),
    };
    if (mpStatus !== null && MP_REFUND_DEAD_STATUSES.has(mpStatus)) {
      await refunds.updateIfStatus(refund.id, "processing", patch);
      return fail(
        refund,
        "unexpected_refund_status",
        new ApiError(502, "PAYMENT_PROVIDER_ERROR", "Mercado Pago no confirmó el reembolso"),
        `estado del reembolso en MP: ${mpStatus}`,
        { mpStatus }
      );
    }
    if (mpStatus !== null && MP_REFUND_PENDING_STATUSES.has(mpStatus)) {
      // MP lo aceptó pero todavía no lo acreditó: sigue `processing` (cuenta para el tope y el webhook lo promueve a
      // `succeeded` cuando MP lo informa). `last_error` lo deja reintentable, no "en manos de alguien".
      await refunds.updateIfStatus(refund.id, "processing", { ...patch, lastError: `en curso en Mercado Pago (${mpStatus})` });
      log.warn({ shipmentId: refund.shipmentId, refundId: refund.id, mpStatus }, "reembolso aceptado por MP, todavía en curso");
      return (await refunds.findById(refund.id)) ?? refund;
    }
    // Aprobado, o 2xx sin estado: MP lo creó. Es más seguro darlo por hecho que por fallido (un reintento duplicaría).
    await refunds.updateIfStatus(refund.id, "processing", {
      ...patch,
      status: "succeeded",
      failureReason: null,
      lastError: null,
      completedAt: now(),
    });
    const succeeded = (await refunds.findById(refund.id)) ?? refund;
    log.info(
      { shipmentId: refund.shipmentId, refundId: refund.id, mpRefundId: patch.mpRefundId, amountArs: refund.amountArs.toString() },
      "reembolso realizado"
    );
    return succeeded;
  }

  /**
   * Reintenta un intento `processing` de un pedido anterior. Dos guardas antes de hablar con MP:
   * - **Antigüedad.** MP recuerda la key por tiempo limitado: pasado `MP_IDEMPOTENCY_SAFE_WINDOW_MS` un reembolso que MP
   *   sí había hecho se repetiría (en un parcial, devolviendo de más). Se deja como está, se alerta y lo mira una persona.
   * - **Un solo pedido a la vez.** `claim` es atómico: el que pierde recibe 409 `REFUND_IN_PROGRESS` sin llamar a MP (así no
   *   topa con el 409 de "en curso" de MP, que se leería como un reembolso sin confirmar y alertaría de más).
   */
  async function resume(refund: Refund): Promise<Refund> {
    const current = now();
    if (current.getTime() - refund.createdAt.getTime() > MP_IDEMPOTENCY_SAFE_WINDOW_MS) {
      log.error({ shipmentId: refund.shipmentId, refundId: refund.id, createdAt: refund.createdAt }, "reembolso sin confirmar demasiado viejo para reintentarlo");
      await alert(
        "refund_needs_review",
        "Un reembolso lleva sin confirmarse más de lo que Mercado Pago garantiza la key: reintentarlo podría devolver la plata dos veces. Mirar el pago en MP",
        refund,
        { createdAt: refund.createdAt.toISOString() }
      );
      throw new ApiError(409, "REFUND_NEEDS_REVIEW", "El reembolso quedó sin confirmar hace demasiado: lo tiene que revisar una persona");
    }
    const claimed = await refunds.claim(refund.id, new Date(current.getTime() - REFUND_IN_FLIGHT_LEASE_MS));
    if (!claimed) {
      throw new ApiError(409, "REFUND_IN_PROGRESS", "Otro pedido con la misma idempotencyKey está procesando este reembolso: reintentá en unos segundos");
    }
    return drive(refund, true);
  }

  async function loadRefundable(shipmentId: string): Promise<Settlement> {
    const settlement = await settlements.findByShipment(shipmentId);
    if (!settlement) throw new ApiError(404, "SETTLEMENT_NOT_FOUND", "El envío no tiene liquidación");
    if (settlement.status !== "credited") {
      throw new ApiError(
        409,
        "SETTLEMENT_NOT_REFUNDABLE",
        `La liquidación está en estado ${settlement.status}: solo se reembolsa un pago ya capturado`
      );
    }
    return settlement;
  }

  return {
    async refund(shipmentId: string, request: CreateRefundRequest): Promise<CreateRefundResponse> {
      const reason = request.reason.trim();
      if (reason.length < REFUND_REASON_MIN_LENGTH || reason.length > REFUND_REASON_MAX_LENGTH) {
        throw new ApiError(400, "VALIDATION_FAILED", `El motivo tiene que tener entre ${REFUND_REASON_MIN_LENGTH} y ${REFUND_REASON_MAX_LENGTH} caracteres`);
      }
      const requestKey = request.idempotencyKey.trim();
      if (requestKey.length === 0 || requestKey.length > REFUND_IDEMPOTENCY_KEY_MAX_LENGTH) {
        throw new ApiError(400, "VALIDATION_FAILED", "idempotencyKey inválida");
      }
      let amount: Prisma.Decimal | null = null;
      if (request.amountArs !== undefined) {
        assertValidAmount(request.amountArs);
        amount = toMoney(request.amountArs);
      }

      const settlement = await loadRefundable(shipmentId);

      let reserved;
      try {
        reserved = await refunds.reserve({
          settlementId: settlement.id,
          shipmentId: settlement.shipmentId,
          holdId: settlement.holdId,
          carrierId: settlement.carrierId,
          mpPaymentId: settlement.mpPaymentId,
          capturedAmountArs: settlement.grossAmountArs,
          amountArs: amount,
          reason,
          requestKey,
          requestFingerprint: fingerprintOf({ amount: amount?.toFixed(2) ?? null, reason }),
          adminId: request.adminId,
        });
      } catch (error) {
        if (error instanceof RefundAmountExceedsError) {
          throw new ApiError(
            422,
            "REFUND_AMOUNT_EXCEEDS_REFUNDABLE",
            `El monto supera lo reembolsable (${error.refundableArs.toString()})`,
            { refundableArs: error.refundableArs.toNumber() }
          );
        }
        if (error instanceof RefundIdempotencyConflictError) {
          throw new ApiError(409, "REFUND_IDEMPOTENCY_CONFLICT", "La idempotencyKey ya se usó con otro monto o motivo");
        }
        throw error;
      }

      if (reserved.kind === "created") {
        return { refund: toRefundResponse(await drive(reserved.refund, false)), replayed: false };
      }
      if (reserved.refund.status !== "processing") {
        return { refund: toRefundResponse(reserved.refund), replayed: true };
      }
      return { refund: toRefundResponse(await resume(reserved.refund)), replayed: false };
    },

    /** Los intentos del envío y lo que todavía se puede reembolsar. `SETTLEMENT_NOT_FOUND` si no hay liquidación. */
    async list(shipmentId: string): Promise<RefundsResponse> {
      const settlement = await settlements.findByShipment(shipmentId);
      if (!settlement) throw new ApiError(404, "SETTLEMENT_NOT_FOUND", "El envío no tiene liquidación");
      const rows = await refunds.listBySettlement(settlement.id);
      return {
        refunds: rows.map(toRefundResponse),
        refundableArs: settlement.status === "credited" ? refundableAmount(settlement.grossAmountArs, rows).toNumber() : 0,
      };
    },
  };
}

export type RefundService = ReturnType<typeof createRefundService>;
