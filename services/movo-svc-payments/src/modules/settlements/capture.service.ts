import type { FastifyBaseLogger } from "fastify";
import { ApiError, carrierPaymentView, SettlementFailureReason, SettlementResponse, estimateMpFeeArs } from "@movo/shared";
import { Prisma } from "../../generated/prisma/client";
import { MercadoPagoClient, PaymentSnapshot } from "../../adapters/mercadopago-client";
import { CarrierMpAccountRepository } from "../../repositories/carrier-mp-account-repository";
import { Hold, HoldRepository } from "../../repositories/hold-repository";
import { Settlement, SettlementRepository } from "../../repositories/settlement-repository";
import { HoldDebtSettlement, UserLedgerRepository } from "../../repositories/user-ledger-repository";
import { missingCardFields } from "../../utils/payment-card";
import { splitCollectorFees, toMoney } from "../../utils/payment-fee";
import { assertValidAmount, readMpError } from "../holds/hold.service";
import { splitRetainedFee } from "../holds/retained-fee";

// Vive en `holds/retained-fee` para que el hold y la liquidación repartan el fee con la misma regla.
export { splitRetainedFee };
export type { RetainedFeeSplit } from "../holds/retained-fee";

const { Decimal } = Prisma;
type Decimal = Prisma.Decimal;

/**
 * Causas con las que MP rechaza una captura parcial que no deja neto para el transportista:
 * `4201` si no supera el `application_fee`, `2072` si lo supera pero no alcanza para el fee
 * de MP (sandbox, review de PR #261: sobre fee 150, 155 da `2072` y 157 se acepta con $0,56
 * de neto). En los dos casos el hold sigue `authorized`.
 */
const CAPTURE_BELOW_FEES_CAUSES = new Set(["4201", "2072"]);

const belowFeesError = (amount: Decimal, applicationFee: Decimal) =>
  new ApiError(
    422,
    "CAPTURE_BELOW_APPLICATION_FEE",
    `La penalidad (${amount.toString()}) no cubre la comisión del hold (${applicationFee.toString()}) más la de Mercado Pago`
  );

/**
 * Qué capturar (MOVO-306). La entrega siempre cobra lo autorizado; la penalidad de cancelación
 * cobra `amountArs` y MP libera el resto.
 */
export type CaptureRequest = { kind: "delivery" } | { kind: "cancellation_penalty"; amountArs: number };

export interface CaptureResult {
  settlement: SettlementResponse;
  /** `true` si no se le pegó a MP: la liquidación ya estaba acreditada. */
  replayed: boolean;
}

export function toSettlementResponse(s: Settlement): SettlementResponse {
  return {
    id: s.id,
    shipmentId: s.shipmentId,
    holdId: s.holdId,
    carrierId: s.carrierId,
    mpPaymentId: s.mpPaymentId,
    status: s.status,
    kind: s.kind,
    grossAmountArs: s.grossAmountArs.toNumber(),
    mpFeeArs: s.mpFeeArs?.toNumber() ?? null,
    commissionArs: s.commissionArs.toNumber(),
    debtOffsetArs: s.debtOffsetArs.toNumber(),
    debtSurchargeArs: s.debtSurchargeArs.toNumber(),
    // Antes de acreditar no hay vista del transportista: el bruto del hold y sin comisión de MP.
    carrierGrossAmountArs: (s.carrierGrossAmountArs ?? s.grossAmountArs).toNumber(),
    carrierMpFeeArs: s.carrierMpFeeArs?.toNumber() ?? null,
    netAmountArs: s.netAmountArs?.toNumber() ?? null,
    failureReason: (s.failureReason as SettlementFailureReason | null) ?? null,
    capturedAt: s.capturedAt?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

export interface FeeBreakdown {
  mpFeeArs: Decimal;
  commissionArs: Decimal;
  netAmountArs: Decimal;
}

/**
 * Desglose real de un pago ya capturado (`fee_details` + `net_received_amount`), o `null`
 * si MP todavía no lo devuelve completo. La comisión de Movo es el `application_fee`; la
 * de MP es el resto de lo que descuenta al TRANSPORTISTA (`fee_payer: collector`). Un cargo
 * que paga el emisor (`financing_fee` con `fee_payer: payer`, cuando paga en cuotas) no
 * le toca al transportista: contarlo inflaba la comisión de MP y rompía
 * `mpFee + commission + net == gross`. Aritmética en `Decimal`: es plata, nada de floats.
 */
export function readFeeBreakdown(payment: PaymentSnapshot, fallbackCommission: Decimal): FeeBreakdown | null {
  const net = payment.transaction_details?.net_received_amount;
  const fees = payment.fee_details;
  if (net === undefined || !fees || fees.length === 0) return null;

  const split = splitCollectorFees(fees);
  if (!split) return null;
  return { mpFeeArs: split.mpFee, commissionArs: split.commission ?? fallbackCommission, netAmountArs: toMoney(net) };
}

export interface CaptureServiceDeps {
  holds: HoldRepository;
  /** MOVO-311: asienta en la cuenta corriente la deuda que cobró el hold. */
  ledger: Pick<UserLedgerRepository, "settleHoldDebt">;
  settlements: SettlementRepository;
  accounts: CarrierMpAccountRepository;
  mercadoPago: MercadoPagoClient;
  log: FastifyBaseLogger;
  now?: () => Date;
}

/**
 * MOVO-212: captura el hold de un envío entregado y registra la liquidación. Único camino
 * de `svc-shipments` hacia el cobro.
 *
 * **Idempotencia (AC7).** Tres capas, de la más barata a la más fuerte:
 * 1. una liquidación `credited` se devuelve sin tocar a MP;
 * 2. hay UNA fila por envío (`shipment_id` único), que se crea en `processing` antes de
 *    llamar a MP: dos pedidos simultáneos comparten fila, no abren dos cobros;
 * 3. la captura va con la key `movo-hold-capture-<holdId>`, así que un reintento tras una
 *    respuesta perdida devuelve la misma captura. Si igual falla, se consulta el pago y,
 *    si ya está `approved`, se adopta en vez de capturar de nuevo.
 *
 * **Monto (AC3).** Se captura SIN `amount`: MP cobra exactamente lo autorizado.
 *
 * **Penalidad de cancelación (MOVO-306).** La misma máquina, con `kind: cancellation_penalty`:
 * captura PARTE del hold (`amount`) con su propia key (`movo-hold-penalty-<holdId>`) y MP libera
 * el resto. Sigue siendo una liquidación por envío: un pedido de otro tipo o por otro monto que
 * la existente es `409 SETTLEMENT_CONFLICT`. Spike MOVO-305: MP cobra el `application_fee`
 * ENTERO (no lo prorratea) y solo acepta la captura si al transportista le queda neto (lo
 * capturado tiene que superar ese fee más el de MP). Eso se valida antes de llamar a MP y antes de
 * crear la fila, con el fee de MP estimado; si igual MP la rechaza, se responde el mismo 422.
 *
 * **Fallos (AC8).** Este servicio no sabe nada del estado del envío, así que no puede
 * revertir la entrega: un fallo deja la liquidación en `failed` (o `processing`) y el
 * hold como estaba. El reintento con backoff y el escalado son MOVO-213.
 */
export function createCaptureService(deps: CaptureServiceDeps) {
  const { holds, settlements, accounts, mercadoPago, ledger, log } = deps;
  const now = deps.now ?? (() => new Date());

  const captureKey = (settlement: Settlement) =>
    settlement.kind === "cancellation_penalty"
      ? `movo-hold-penalty-${settlement.holdId}`
      : `movo-hold-capture-${settlement.holdId}`;

  /** Una liquidación por envío: otro tipo u otro monto no se pisa ni se devuelve como si fuera la pedida. */
  function assertMatches(existing: Settlement, request: CaptureRequest): void {
    const sameAmount =
      request.kind !== "cancellation_penalty" || existing.grossAmountArs.equals(toMoney(request.amountArs));
    if (existing.kind !== request.kind || !sameAmount) {
      throw new ApiError(
        409,
        "SETTLEMENT_CONFLICT",
        `El envío ya tiene una liquidación de tipo ${existing.kind} por ${existing.grossAmountArs.toString()}`
      );
    }
  }

  /**
   * MOVO-306: lo que se captura como penalidad tiene que entrar en el hold y dejarle neto al
   * transportista: superar la comisión de Movo más el fee de MP. El de MP se estima con la tasa
   * de `@movo/shared` (más alta que la real del sandbox, 4,1 %): ante la duda gana el plan B.
   */
  function penaltyAmount(hold: Hold, amountArs: number): Decimal {
    assertValidAmount(amountArs);
    const amount = toMoney(amountArs);
    if (amount.gt(hold.amountArs)) {
      throw new ApiError(
        422,
        "CAPTURE_AMOUNT_EXCEEDS_HOLD",
        `La penalidad (${amount.toString()}) supera el monto del hold (${hold.amountArs.toString()})`
      );
    }
    const estimatedMpFee = toMoney(estimateMpFeeArs(amount.toNumber()));
    if (amount.minus(estimatedMpFee).lte(hold.applicationFeeArs)) {
      throw belowFeesError(amount, hold.applicationFeeArs);
    }
    return amount;
  }

  async function fail(
    settlement: Settlement,
    reason: SettlementFailureReason,
    error: ApiError,
    context: Record<string, unknown> = {}
  ): Promise<never> {
    // Condicional sobre `processing`: si otro llamador (la captura en línea, el reintento) ya la
    // acreditó, un fallo tardío no la pisa. El error igual sube; `capture()` lo resuelve releyendo.
    const applied = await settlements.updateIfStatus(settlement.id, "processing", { status: "failed", failureReason: reason });
    if (!applied) {
      log.warn(
        { shipmentId: settlement.shipmentId, holdId: settlement.holdId, reason },
        "captura fallida ignorada: la liquidación ya no estaba en processing"
      );
    }
    log.error({ shipmentId: settlement.shipmentId, holdId: settlement.holdId, reason, ...context }, "captura fallida");
    throw error;
  }

  /** Con la captura confirmada por MP: hold `captured` y desglose real en la liquidación. */
  async function finalize(settlement: Settlement, hold: Hold, accessToken: string): Promise<Settlement> {
    let payment: PaymentSnapshot;
    try {
      payment = await mercadoPago.getPayment(accessToken, settlement.mpPaymentId);
    } catch (error) {
      // La plata ya se cobró; falta solo el desglose. Queda `processing` y el próximo
      // pedido de captura entra por acá (hold `captured`) sin volver a capturar.
      log.error(
        { shipmentId: settlement.shipmentId, holdId: hold.id, reason: readMpError(error).message },
        "captura confirmada pero falló la consulta del desglose a MP"
      );
      throw new ApiError(502, "PAYMENT_PROVIDER_ERROR", "El cobro se realizó pero no se pudo leer el desglose: reintentá");
    }

    if (payment.status !== "approved") {
      return fail(
        settlement,
        "unexpected_payment_status",
        new ApiError(502, "PAYMENT_PROVIDER_ERROR", "Mercado Pago devolvió un estado de pago inesperado tras la captura"),
        { mpStatus: payment.status }
      );
    }

    const breakdown = readFeeBreakdown(payment, hold.applicationFeeArs);
    if (!breakdown) {
      log.error(
        { shipmentId: settlement.shipmentId, holdId: hold.id, mpPaymentId: settlement.mpPaymentId },
        "pago capturado sin desglose de comisiones en MP"
      );
      throw new ApiError(502, "PAYMENT_PROVIDER_ERROR", "Mercado Pago todavía no devolvió el desglose del cobro: reintentá");
    }

    // Verificaciones de coherencia: no frenan el registro (el dinero ya se movió y la
    // verdad es lo que dice MP), pero dejan rastro para auditar.
    const gross = settlement.grossAmountArs;
    if (payment.transaction_amount !== undefined && !toMoney(payment.transaction_amount).equals(gross)) {
      log.error(
        { shipmentId: settlement.shipmentId, holdAmount: gross.toString(), mpAmount: payment.transaction_amount },
        "el monto del pago en MP no coincide con el de la liquidación"
      );
    }
    if (!breakdown.commissionArs.equals(hold.applicationFeeArs)) {
      log.error(
        { shipmentId: settlement.shipmentId, expected: hold.applicationFeeArs.toString(), mp: breakdown.commissionArs.toString() },
        "el application_fee en MP no coincide con el del hold"
      );
    }
    const split = splitRetainedFee(hold, breakdown.commissionArs);
    const accounted = breakdown.mpFeeArs.plus(breakdown.commissionArs).plus(breakdown.netAmountArs);
    if (!accounted.equals(gross)) {
      log.error(
        { shipmentId: settlement.shipmentId, gross: gross.toString(), accounted: accounted.toString() },
        "bruto distinto de fee de MP + comisión + neto"
      );
    }

    if (hold.status !== "captured") {
      // Condicional sobre `authorized`: si el webhook movió el hold en el medio no se pisa. MP ya
      // cobró, así que la liquidación se acredita igual.
      const moved = await holds.markCaptured(hold.id, {
        statusDetail: payment.status_detail ?? null,
        // MOVO-302: sin pisar una tarjeta que el hold ya tenía.
        ...missingCardFields(hold, payment),
        mpFeeArs: breakdown.mpFeeArs.toNumber(),
      });
      if (!moved) {
        log.warn(
          { shipmentId: settlement.shipmentId, holdId: hold.id, mpPaymentId: settlement.mpPaymentId },
          "el hold ya no estaba authorized al capturarlo: MP cobró, se acredita la liquidación"
        );
      }
    }
    // MOVO-311: la deuda se asienta ANTES de acreditar: una liquidación `credited` se devuelve sin volver a
    // pasar por acá, así que acreditada implica deuda asentada. Asentar es idempotente.
    if (hold.debtOffsetArs.greaterThan(0) || hold.debtSurchargeArs.greaterThan(0)) {
      const settled: HoldDebtSettlement[] = [
        { type: "fee_offset", amountArs: split.debtOffsetArs },
        { type: "payment_surcharge", amountArs: split.debtSurchargeArs },
      ];
      await ledger.settleHoldDebt(hold.id, settled);
    }
    // La vista del transportista (sin el recargo del emisor) se fija una vez acá; el historial y la liquidación la leen.
    const carrierView = carrierPaymentView({
      grossAmountArs: gross.toNumber(),
      mpFeeArs: breakdown.mpFeeArs.toNumber(),
      // En una penalidad (captura parcial) no se cobró recargo aparte: lo capturado ya es lo que ve el transportista.
      debtSurchargeArs: settlement.kind === "delivery" ? split.debtSurchargeArs.toNumber() : 0,
      debtSurchargeFeeArs: settlement.kind === "delivery" ? split.debtSurchargeFeeArs.toNumber() : 0,
    });
    const credited = await settlements.update(settlement.id, {
      status: "credited",
      failureReason: null,
      statusDetail: payment.status_detail ?? null,
      mpFeeArs: breakdown.mpFeeArs,
      commissionArs: split.commissionArs,
      debtOffsetArs: split.debtOffsetArs,
      debtSurchargeArs: split.debtSurchargeArs,
      debtSurchargeFeeArs: split.debtSurchargeFeeArs,
      carrierGrossAmountArs: toMoney(carrierView.grossAmountArs),
      carrierMpFeeArs: carrierView.mpFeeArs === null ? null : toMoney(carrierView.mpFeeArs),
      netAmountArs: breakdown.netAmountArs,
      capturedAt: now(),
    });
    log.info(
      {
        shipmentId: credited.shipmentId,
        holdId: hold.id,
        mpPaymentId: credited.mpPaymentId,
        grossArs: gross.toString(),
        mpFeeArs: breakdown.mpFeeArs.toString(),
        commissionArs: split.commissionArs.toString(),
        debtOffsetArs: split.debtOffsetArs.toString(),
        debtSurchargeArs: split.debtSurchargeArs.toString(),
        netArs: breakdown.netAmountArs.toString(),
      },
      "hold capturado y liquidación acreditada"
    );
    return credited;
  }

  /** Pide la captura a MP; si falla, decide si el pago ya estaba capturado. */
  async function captureInMp(settlement: Settlement, hold: Hold, accessToken: string): Promise<void> {
    let payment: PaymentSnapshot;
    try {
      payment = await mercadoPago.capturePayment(accessToken, settlement.mpPaymentId, {
        idempotencyKey: captureKey(settlement),
        // La entrega va sin `amount` (AC3 de MOVO-212); la penalidad, por lo que se liquida.
        ...(settlement.kind === "cancellation_penalty" ? { amount: settlement.grossAmountArs.toNumber() } : {}),
      });
    } catch (error) {
      const info = readMpError(error);
      // Si MP ya había capturado (respuesta perdida cuya key ya venció), el objetivo está
      // cumplido: se adopta. Cualquier otra cosa es un fallo de verdad.
      let current: PaymentSnapshot | null = null;
      try {
        current = await mercadoPago.getPayment(accessToken, settlement.mpPaymentId);
      } catch {
        // Se informa el error original de la captura.
      }
      if (current?.status === "approved") return;

      const context = { mpHttpStatus: info.status, mpCauseCodes: info.causeCodes, mpStatus: current?.status, reason: info.message };
      // La estimación del fee de MP no alcanzó y MP rechazó la penalidad: mismo 422 que la
      // validación previa, para que `svc-shipments` aplique el plan B en vez de reintentar.
      if (settlement.kind === "cancellation_penalty" && info.causeCodes.some((code) => CAPTURE_BELOW_FEES_CAUSES.has(code))) {
        return fail(settlement, "provider_error", belowFeesError(settlement.grossAmountArs, hold.applicationFeeArs), context);
      }
      if (info.status === 401 || info.status === 403) {
        return fail(
          settlement,
          "carrier_account_unavailable",
          new ApiError(409, "CARRIER_MP_ACCOUNT_NOT_LINKED", "Mercado Pago rechazó las credenciales del transportista: no se pudo capturar"),
          context
        );
      }
      const expired = current?.status === "cancelled" || (hold.expiresAt !== null && hold.expiresAt <= now());
      if (expired) {
        return fail(
          settlement,
          "hold_expired",
          new ApiError(409, "HOLD_NOT_CAPTURABLE", "La reserva venció o fue cancelada en Mercado Pago: no se puede capturar"),
          context
        );
      }
      return fail(settlement, "provider_error", new ApiError(502, "PAYMENT_PROVIDER_ERROR", "No se pudo capturar el hold en Mercado Pago"), context);
    }

    if (payment.status !== "approved") {
      return fail(
        settlement,
        "unexpected_payment_status",
        new ApiError(502, "PAYMENT_PROVIDER_ERROR", "Mercado Pago no confirmó la captura del hold"),
        { mpStatus: payment.status }
      );
    }
  }

  return {
    /**
     * Captura el hold del envío. Idempotente: acreditada → se devuelve tal cual; `failed` o
     * `processing` → se reintenta desde donde quedó.
     */
    async capture(shipmentId: string, request: CaptureRequest = { kind: "delivery" }): Promise<CaptureResult> {
      const existing = await settlements.findByShipment(shipmentId);
      if (existing) assertMatches(existing, request);
      if (existing?.status === "credited") {
        return { settlement: toSettlementResponse(existing), replayed: true };
      }

      const hold = await holds.findLatestByShipment(shipmentId);
      if (!hold) throw new ApiError(404, "HOLD_NOT_FOUND", "El envío no tiene ningún hold");
      if (existing && existing.holdId !== hold.id) {
        throw new ApiError(409, "HOLD_CONFLICT", "La liquidación del envío pertenece a otro hold");
      }
      if (hold.status !== "authorized" && hold.status !== "captured") {
        throw new ApiError(409, "HOLD_NOT_CAPTURABLE", `El hold está en estado ${hold.status}: no se puede capturar`);
      }
      if (!hold.mpPaymentId) {
        throw new ApiError(409, "HOLD_NOT_CAPTURABLE", "El hold no tiene un pago asociado en Mercado Pago");
      }

      const grossAmountArs =
        request.kind === "cancellation_penalty" ? penaltyAmount(hold, request.amountArs) : hold.amountArs;

      // La fila `processing` se escribe antes de hablar con MP (ver doc del service).
      let settlement = await settlements.findOrCreateProcessing({
        shipmentId,
        kind: request.kind,
        holdId: hold.id,
        carrierId: hold.carrierId,
        mpPaymentId: hold.mpPaymentId,
        grossAmountArs,
        commissionArs: hold.commissionArs,
      });
      // Otro pedido pudo crear la fila entre la lectura de arriba y el upsert.
      assertMatches(settlement, request);
      if (settlement.status === "credited") {
        return { settlement: toSettlementResponse(settlement), replayed: true };
      }

      const credentials = await accounts.findCredentials(hold.carrierId);
      const usable = credentials !== null && (credentials.tokenExpiresAt === null || credentials.tokenExpiresAt > now());

      // Un fallo permanente no se reintenta: volver a `processing` y pegarle a MP cada pasada del
      // barrido solo oscila el estado y gasta llamadas. `hold_expired` no se arregla nunca; una
      // cuenta de MP sin credenciales usables solo se arregla si el transportista se re-vincula
      // (o MOVO-243 refresca el token), o sea, si la vinculación cambió después del fallo.
      if (settlement.status === "failed") {
        if (settlement.failureReason === "hold_expired") {
          throw new ApiError(409, "HOLD_NOT_CAPTURABLE", "La reserva venció o fue cancelada en Mercado Pago: no se puede capturar");
        }
        if (settlement.failureReason === "carrier_account_unavailable" && (!usable || credentials.updatedAt <= settlement.updatedAt)) {
          throw new ApiError(
            409,
            "CARRIER_MP_ACCOUNT_NOT_LINKED",
            "No hay credenciales vigentes del transportista para capturar el hold"
          );
        }
        settlement = await settlements.update(settlement.id, { status: "processing", failureReason: null });
      }

      if (!usable) {
        // Token vencido: MP respondería 401 y el refresco es de MOVO-243 (no hay flujo en este
        // servicio todavía). Se falla sin llamar a MP; se retoma cuando la vinculación se renueve.
        return fail(
          settlement,
          "carrier_account_unavailable",
          new ApiError(
            409,
            "CARRIER_MP_ACCOUNT_NOT_LINKED",
            credentials
              ? "El token de Mercado Pago del transportista venció: no se puede capturar hasta que se renueve"
              : "No hay credenciales vigentes del transportista para capturar el hold"
          ),
          { mpPaymentId: hold.mpPaymentId, expiresAt: hold.expiresAt, tokenExpired: credentials !== null }
        );
      }

      log.info(
        { shipmentId, holdId: hold.id, mpPaymentId: hold.mpPaymentId, holdStatus: hold.status },
        "capturando hold en MP"
      );
      try {
        // Un hold ya `captured` (la plata se cobró pero se cortó antes del desglose) no
        // vuelve a capturarse: solo se completa la liquidación.
        if (hold.status === "authorized") await captureInMp(settlement, hold, credentials.accessToken);
        const credited = await finalize(settlement, hold, credentials.accessToken);
        return { settlement: toSettlementResponse(credited), replayed: false };
      } catch (error) {
        // Carrera con otro llamador (captura en línea vs. reintento): si ya la acreditó, el objetivo
        // está cumplido y este fallo no cuenta.
        const latest = await settlements.findByShipment(shipmentId);
        if (latest?.status === "credited") return { settlement: toSettlementResponse(latest), replayed: true };
        throw error;
      }
    },

    /** AC10: la liquidación del envío, completa. El filtro por rol lo aplica quien la expone. */
    async getByShipment(shipmentId: string): Promise<SettlementResponse> {
      const settlement = await settlements.findByShipment(shipmentId);
      if (!settlement) throw new ApiError(404, "SETTLEMENT_NOT_FOUND", "El envío no tiene liquidación");
      return toSettlementResponse(settlement);
    },
  };
}

export type CaptureService = ReturnType<typeof createCaptureService>;
