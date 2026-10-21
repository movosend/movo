import { createHash } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import { ApiError } from "@movo/shared";
import type { BalancePayDataResponse, BalancePayRequest, BalancePayResponse } from "@movo/shared";
import { Prisma } from "../../generated/prisma/client";
import type { MercadoPagoClient, PaymentSnapshot } from "../../adapters/mercadopago-client";
import type { AlertNotifier } from "../../adapters/alert-notifier";
import type {
  BalancePaymentAttempt,
  BalancePaymentAttemptRepository,
} from "../../repositories/balance-payment-attempt-repository";
import type { SavedCardRepository } from "../../repositories/saved-card-repository";
import type { UserLedgerService } from "../user-ledger/user-ledger.service";
import { classifyCreateError, failureReasonFromStatusDetail, readMpError } from "../holds/hold.service";

/** Un intento `creating` más viejo que esto es de un proceso que murió a mitad de camino: si MP no tiene el pago, se descarta. */
export const BALANCE_STALE_CREATING_MS = 10 * 60 * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Estados de un pago de MP que Movo no inició y que hay que mirar a mano. */
const ATTENTION_STATUSES = new Set(["refunded", "charged_back", "in_mediation"]);
/** Estados de MP en los que el pago todavía puede terminar aprobado. */
const WAITING_STATUSES = new Set(["pending", "in_process", "authorized"]);

/**
 * Cuenta cobradora: la propia cuenta de MP de Movo S.A., configurada con sus credenciales (ADR-048). En producción son las
 * credenciales productivas del panel; en el sandbox, el token `TEST-` del OAuth de la cuenta de prueba (`scripts/collector-oauth.mjs`).
 */
export interface BalanceCollector {
  mpUserId: string;
  accessToken: string;
  publicKey: string;
}

export interface BalancePaymentDeps {
  attempts: BalancePaymentAttemptRepository;
  ledger: Pick<UserLedgerService, "balance" | "createEntry">;
  /**
   * MOVO-311: deuda que todavía no tomó ningún hold (`readBalanceNetOfReservations`): el máximo a pagar. El saldo que se
   * muestra (`ledger.balance`) no descuenta las reservas, pero pagar esa parte la dejaría a favor cuando el hold cobre.
   */
  payableBalance: (userId: string) => Promise<number>;
  mercadoPago: MercadoPagoClient;
  /** Tarjeta guardada y customer del usuario en la cuenta de Movo S.A. (ADR-039): igual que al pagar un envío. */
  savedCards: Pick<SavedCardRepository, "findLive" | "findCustomer">;
  /** `MP_COLLECTOR_*`: `undefined` si falta alguna de las tres variables. */
  collector: BalanceCollector | undefined;
  alerts: AlertNotifier;
  log: FastifyBaseLogger;
  now?: () => Date;
}

/** Con signo, mayor que cero y hasta 2 decimales (Ajv compara en float: los decimales se miran acá). */
function assertValidAmount(amountArs: number): void {
  if (!Number.isFinite(amountArs) || amountArs <= 0 || Math.round(amountArs * 100) / 100 !== amountArs) {
    throw new ApiError(400, "VALIDATION_FAILED", "amountArs tiene que ser mayor que cero, con hasta 2 decimales");
  }
}

/** Huella del pedido: un reintento con la misma key solo es seguro con el mismo token, tarjeta y medio de pago. */
function requestFingerprint(input: BalancePayRequest): string {
  return createHash("sha256")
    .update(JSON.stringify([input.cardToken, input.savedCardId, input.paymentMethodId ?? ""]))
    .digest("hex");
}

/** Resultado de procesar un pago de MP: qué quedó escrito, para el log y la resolución del webhook. */
export type BalancePaymentOutcome =
  | "settled"
  | "already_settled"
  | "amount_mismatch"
  | "rejected"
  | "waiting"
  | "attention"
  | "payment_conflict";

/**
 * MOVO-312: "Pagar mi saldo" con Checkout API. El usuario paga sin salir de la app, igual que un envío: tarjeta
 * guardada + CVV, token hecho en el dispositivo con la `public_key` de la cuenta cobradora de Movo, y el pago se crea
 * con el token OAuth de esa misma cuenta (captura inmediata, sin hold ni `application_fee`: la plata ya es de Movo).
 *
 * - **Idempotencia**: una fila por intento, `X-Idempotency-Key = movo-balance-<intento>`, e índice único parcial
 *   (un intento abierto por usuario): dos pedidos en vuelo no suman más que la deuda y los iguales comparten un único pago.
 * - **Plata una sola vez**: el movimiento `voluntary_payment` se asienta con la `idempotencyKey`
 *   `balance-payment:<intento>`; el estado del intento es informativo y no decide si se acredita.
 * - **Nada se confía del body del webhook**: el estado sale siempre de consultar el pago con el token de la cobradora.
 */
export function createBalancePaymentService(deps: BalancePaymentDeps) {
  const { attempts, ledger, mercadoPago, savedCards, alerts, log } = deps;
  const now = deps.now ?? (() => new Date());

  /** La cuenta cobradora tiene que estar configurada. */
  async function collector(): Promise<BalanceCollector> {
    if (!deps.collector) {
      log.error("la cuenta cobradora de Movo no está configurada (MP_COLLECTOR_*)");
      throw new ApiError(503, "BALANCE_COLLECTOR_NOT_CONFIGURED", "El pago de saldo no está disponible en este momento.");
    }
    return deps.collector;
  }

  /** El webhook: ¿esta notificación es de la cuenta cobradora de Movo? `null` si no está configurada. */
  async function collectorForWebhook(mpUserId: string | undefined): Promise<BalanceCollector | null> {
    const c = deps.collector;
    if (!c) return null;
    return mpUserId && mpUserId !== c.mpUserId ? null : c;
  }

  /** Asienta el pago aprobado. Idempotente: el ledger deduplica por `balance-payment:<intento>`. */
  async function settleApproved(attempt: BalancePaymentAttempt, payment: PaymentSnapshot): Promise<BalancePaymentOutcome> {
    const paymentId = String(payment.id);
    const entry = await ledger.createEntry(attempt.userId, {
      idempotencyKey: `balance-payment:${attempt.id}`,
      type: "voluntary_payment",
      amountArs: -attempt.amountArs.toNumber(),
      status: "settled",
      paymentId,
    });
    const linked = await attempts.markApproved(attempt.id, paymentId, payment.status_detail ?? null);
    if (!linked) {
      // El movimiento ya está (o recién se asentó), pero el intento figura con otro pago: que lo mire una persona.
      log.error({ attemptId: attempt.id, mpPaymentId: paymentId }, "pago de saldo aprobado que no se pudo vincular al intento");
      await alerts.send({
        kind: "mp_balance_payment_conflict",
        message: "Pago de saldo aprobado en MP que no coincide con el pago ya vinculado al intento",
        context: { attemptId: attempt.id, userId: attempt.userId, mpPaymentId: paymentId },
      });
      return "payment_conflict";
    }
    if (entry.created) {
      log.info({ attemptId: attempt.id, userId: attempt.userId, mpPaymentId: paymentId }, "pago de saldo acreditado en la cuenta corriente");
    }
    return entry.created ? "settled" : "already_settled";
  }

  /** Aplica el estado de un pago de MP (ya consultado con el token de la cobradora) a su intento. */
  async function applyToAttempt(attempt: BalancePaymentAttempt, payment: PaymentSnapshot): Promise<BalancePaymentOutcome> {
    const status = payment.status ?? "";
    const paid = typeof payment.transaction_amount === "number" ? payment.transaction_amount : null;
    if (paid === null || new Prisma.Decimal(paid).toFixed(2) !== attempt.amountArs.toFixed(2)) {
      // El pago se crea con el monto exacto del intento: que no coincida no es del flujo normal. No se acredita nada.
      log.error(
        { attemptId: attempt.id, mpPaymentId: payment.id, mpAmount: paid, attemptAmount: attempt.amountArs.toFixed(2) },
        "pago de saldo con un monto distinto del intento"
      );
      await alerts.send({
        kind: "mp_balance_payment_amount_mismatch",
        message: "Pago de saldo en MP con un monto distinto del intento: no se acreditó",
        context: { attemptId: attempt.id, mpPaymentId: String(payment.id), mpStatus: status, mpAmount: paid },
      });
      return "amount_mismatch";
    }

    if (status === "approved") return settleApproved(attempt, payment);

    if (ATTENTION_STATUSES.has(status)) {
      // Reembolso, contracargo o mediación sobre un pago de saldo: el ledger no se toca solo, lo decide una persona.
      await alerts.send({
        kind: `mp_balance_payment_${status}`,
        message: "Un pago de saldo cambió a un estado que requiere revisión manual",
        context: { attemptId: attempt.id, userId: attempt.userId, mpPaymentId: String(payment.id), mpStatus: status },
      });
      return "attention";
    }

    const mpPaymentId = payment.id !== undefined ? String(payment.id) : null;
    const statusDetail = payment.status_detail ?? null;
    if (status === "rejected" || status === "cancelled") {
      await attempts.updateOpen(attempt.id, {
        status: "rejected",
        mpPaymentId,
        statusDetail,
        failureReason: failureReasonFromStatusDetail(statusDetail, { savedCard: true }),
      });
      return "rejected";
    }
    if (WAITING_STATUSES.has(status)) {
      await attempts.updateOpen(attempt.id, { status: "pending", mpPaymentId, statusDetail });
    }
    return "waiting";
  }

  /**
   * Procesa un pago de MP que llegó por el webhook. `null` si no es de un intento de saldo (el `external_reference`
   * no es de ningún intento): el webhook sigue con el camino de los holds.
   */
  async function applyPayment(payment: PaymentSnapshot): Promise<BalancePaymentOutcome | null> {
    const reference = payment.external_reference;
    if (!reference || !UUID_RE.test(reference)) return null;
    const attempt = await attempts.findById(reference);
    if (!attempt) return null;
    return applyToAttempt(attempt, payment);
  }

  /**
   * Pone al día los intentos abiertos del usuario consultando a MP: un pago aprobado cuyo webhook no llegó se acredita,
   * y uno `creating` sin pago en MP pasado el plazo se descarta. Una falla de MP no bloquea lo que el usuario hace.
   */
  async function reconcileOpen(userId: string, c: BalanceCollector): Promise<void> {
    for (const attempt of await attempts.listOpenByUser(userId)) {
      try {
        const found = await mercadoPago.searchPaymentsByExternalReference(c.accessToken, attempt.id);
        const decisive = found.find((p) => p.status === "approved") ?? found.find((p) => p.status !== undefined);
        if (decisive) {
          await applyToAttempt(attempt, decisive);
        } else if (attempt.status === "creating" && now().getTime() - attempt.createdAt.getTime() > BALANCE_STALE_CREATING_MS) {
          await attempts.updateOpen(attempt.id, { status: "failed", statusDetail: "stale_creating", failureReason: "platform_error" });
        }
      } catch (error) {
        log.warn({ attemptId: attempt.id, err: error instanceof Error ? error.message : String(error) }, "no se pudo conciliar un intento de pago de saldo");
      }
    }
  }

  /** La tarjeta tiene que ser del usuario y estar viva; ante cualquier otra cosa, el mismo 404 sin revelar si existe. */
  async function resolvePayer(userId: string, savedCardId: string): Promise<{ type: "customer"; id: string }> {
    const [card, customer] = await Promise.all([savedCards.findLive(userId, savedCardId), savedCards.findCustomer(userId)]);
    if (!card || !customer) throw new ApiError(404, "SAVED_CARD_NOT_FOUND", "Tarjeta no encontrada.");
    return { type: "customer", id: customer.mpCustomerId };
  }

  async function currentBalance(userId: string): Promise<number> {
    return (await ledger.balance(userId)).balanceArs;
  }

  async function toResponse(attempt: BalancePaymentAttempt, userId: string): Promise<BalancePayResponse> {
    const status = attempt.status === "approved" ? "approved" : attempt.status === "pending" || attempt.status === "creating" ? "pending" : "rejected";
    return {
      attemptId: attempt.id,
      status,
      failureReason: status === "rejected" ? (attempt.failureReason ?? "platform_error") : null,
      balanceArs: await currentBalance(userId),
    };
  }

  /** `GET pay-data`: lo que la app necesita para tokenizar la tarjeta y mostrar el monto máximo. */
  async function getPayData(userId: string): Promise<BalancePayDataResponse> {
    const c = await collector();
    await reconcileOpen(userId, c);
    const balanceArs = await deps.payableBalance(userId);
    if (balanceArs <= 0) throw new ApiError(422, "BALANCE_AMOUNT_EXCEEDS_DEBT", "No tenés deuda para pagar.");
    return { publicKey: c.publicKey, balanceArs };
  }

  async function pay(userId: string, input: BalancePayRequest): Promise<BalancePayResponse> {
    assertValidAmount(input.amountArs);
    const c = await collector();

    // Primero se concilia: un pago aprobado cuyo webhook se perdió baja la deuda antes de validar el monto.
    await reconcileOpen(userId, c);

    // Chequeo previo, sin lock, para responder antes de resolver la tarjeta; el que vale se repite al abrir el intento.
    const balanceArs = await deps.payableBalance(userId);
    if (balanceArs <= 0) throw new ApiError(422, "BALANCE_AMOUNT_EXCEEDS_DEBT", "No tenés deuda para pagar.");
    if (input.amountArs > balanceArs) throw new ApiError(422, "BALANCE_AMOUNT_EXCEEDS_DEBT", "El monto supera tu saldo deudor.");

    // Antes de abrir un intento: una tarjeta ajena o dada de baja no crea ninguna fila.
    const payer = await resolvePayer(userId, input.savedCardId);

    const fingerprint = requestFingerprint(input);
    const amount = new Prisma.Decimal(input.amountArs.toFixed(2));
    const { attempt, created } = await attempts.insertOpen({
      userId,
      amountArs: amount,
      savedCardId: input.savedCardId,
      requestFingerprint: fingerprint,
    });

    if (!created) {
      // Hay un intento abierto (un solo intento abierto por usuario: la suma de lo que está en vuelo no puede superar la
      // deuda). Con otro monto, o con otro token/tarjeta sobre uno sin respuesta, hay que esperar su resultado; el mismo
      // pedido pendiente devuelve su resultado, y uno sin respuesta de MP se reintenta con la MISMA key (MP devuelve el pago
      // ya creado en vez de crear otro).
      const sameAmount = attempt.amountArs.toFixed(2) === amount.toFixed(2);
      if (sameAmount && attempt.status === "pending") return toResponse(attempt, userId);
      if (!sameAmount || attempt.status !== "creating" || attempt.requestFingerprint !== fingerprint) {
        throw new ApiError(409, "BALANCE_PAYMENT_IN_PROGRESS", "Ya hay un pago en curso. Esperá su resultado.");
      }
    }

    // AC9: ni el card_token ni el customer/card id de MP se loguean.
    log.info({ attemptId: attempt.id, userId, amountArs: input.amountArs }, "creando pago de saldo en MP");

    let payment: PaymentSnapshot;
    try {
      payment = await mercadoPago.createPayment(
        c.accessToken,
        {
          transaction_amount: input.amountArs,
          installments: 1,
          token: input.cardToken,
          ...(input.paymentMethodId ? { payment_method_id: input.paymentMethodId } : {}),
          description: "Pago de saldo de Movo",
          // El webhook y la recuperación de un `creating` reconocen el pago por este id.
          external_reference: attempt.id,
          payer,
        },
        `movo-balance-${attempt.id}`
      );
    } catch (error) {
      const info = readMpError(error);
      const outcome = classifyCreateError(info);
      const context = { attemptId: attempt.id, mpHttpStatus: info.status, mpCauseCodes: info.causeCodes };
      if (outcome.kind === "rejected") {
        // MP rechazó el REQUEST por una causa conocida: no se creó pago y repetirlo falla igual.
        log.warn(context, "MP rechazó la creación del pago de saldo");
        await attempts.updateOpen(attempt.id, {
          status: "rejected",
          statusDetail: info.causeCodes[0] ? `mp_error_${info.causeCodes[0]}` : `mp_http_${info.status}`,
          failureReason: outcome.failureReason,
        });
        return toResponse((await attempts.findById(attempt.id)) ?? attempt, userId);
      }
      if (outcome.kind === "carrier_auth") {
        // El token de la cuenta cobradora ya no sirve: MP no procesó el pedido. Lo resuelve una persona.
        log.error(context, "MP rechazó el token de la cuenta cobradora de Movo");
        await alerts.send({
          kind: "mp_balance_collector_auth",
          message: "MP rechazó el token de la cuenta cobradora de Movo al crear un pago de saldo",
          context: { attemptId: attempt.id, userId },
        });
        await attempts.updateOpen(attempt.id, { status: "failed", statusDetail: "collector_auth", failureReason: "platform_error" });
        throw new ApiError(503, "BALANCE_COLLECTOR_NOT_CONFIGURED", "El pago de saldo no está disponible en este momento.");
      }
      // Timeout, red, 408/409/429, 5xx o un 4xx que no entendemos: no se sabe si MP creó el pago. El intento queda en
      // `creating` y el reintento reusa la key.
      log.error({ ...context, reason: info.message }, "MP no respondió al crear el pago de saldo");
      throw new ApiError(502, "PAYMENT_PROVIDER_ERROR", "Mercado Pago no respondió: reintentá con la misma tarjeta");
    }

    log.info({ attemptId: attempt.id, mpStatus: payment.status, mpStatusDetail: payment.status_detail }, "pago de saldo procesado por MP");
    await applyToAttempt(attempt, { ...payment, external_reference: attempt.id });
    return toResponse((await attempts.findById(attempt.id)) ?? attempt, userId);
  }

  return { getPayData, pay, applyPayment, reconcileOpen, collector, collectorForWebhook };
}

export type BalancePaymentService = ReturnType<typeof createBalancePaymentService>;
