import type { FastifyBaseLogger } from "fastify";
import { ApiError } from "@movo/shared";
import type { CreateBalanceCheckoutResponse } from "@movo/shared";
import { Prisma } from "../../generated/prisma/client";
import type { MercadoPagoClient, PaymentSnapshot } from "../../adapters/mercadopago-client";
import type { AlertNotifier } from "../../adapters/alert-notifier";
import type {
  BalancePaymentAttempt,
  BalancePaymentAttemptRepository,
} from "../../repositories/balance-payment-attempt-repository";
import type { UserLedgerService } from "../user-ledger/user-ledger.service";

/** Deep link al que vuelve la app tras el checkout (como `movo://mp-connect` del OAuth, MOVO-111). */
export const BALANCE_RETURN_URL = "movo://balance";
export const BALANCE_RETURN_RESULTS = ["success", "failure", "pending"] as const;
export type BalanceReturnResult = (typeof BALANCE_RETURN_RESULTS)[number];

/** Cuánto vive una preferencia: pasado ese plazo el checkout ya no se puede completar y el intento se abandona. */
export const BALANCE_CHECKOUT_TTL_HOURS = 24;
/** Un intento `creating` más viejo que esto es de un proceso que murió a mitad de camino: se descarta. */
const STALE_CREATING_MS = 2 * 60 * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Sufijo del `MP_REDIRECT_URI` del OAuth (MOVO-111): lo que queda antes es la base pública del API. */
const REDIRECT_URI_SUFFIX = "/payments/mp-connect/callback";

/** Estados de un pago de MP que Movo no inició y que hay que mirar a mano. */
const ATTENTION_STATUSES = new Set(["refunded", "charged_back", "in_mediation"]);

export type BalanceTokenProvider = { getToken(): Promise<string> };

export interface BalanceCheckoutDeps {
  attempts: BalancePaymentAttemptRepository;
  ledger: Pick<UserLedgerService, "balance" | "createEntry">;
  mercadoPago: MercadoPagoClient;
  /** Token de la cuenta de Movo (`MovoTokenProvider`): el cobrador del pago es Movo, no un transportista. */
  movoToken: BalanceTokenProvider;
  alerts: AlertNotifier;
  log: FastifyBaseLogger;
  /** `MP_REDIRECT_URI`: de ahí se deriva la base pública para `back_urls` y `notification_url`. */
  redirectUri: string | undefined;
  /** `MP_TEST_MODE`: en sandbox el navegador abre el `sandbox_init_point`. */
  testMode: boolean;
  now?: () => Date;
}

/** Base pública del API (`https://api-dev.movosend.app/api/v1`) a partir del `redirect_uri` de OAuth. */
export function publicApiBase(redirectUri: string | undefined): string | null {
  if (!redirectUri || !redirectUri.endsWith(REDIRECT_URI_SUFFIX)) return null;
  const base = redirectUri.slice(0, -REDIRECT_URI_SUFFIX.length);
  return base.length > 0 ? base : null;
}

/** Con signo, mayor que cero y hasta 2 decimales (Ajv compara en float: los decimales se miran acá). */
function assertValidAmount(amountArs: number): void {
  if (!Number.isFinite(amountArs) || amountArs <= 0 || Math.round(amountArs * 100) / 100 !== amountArs) {
    throw new ApiError(400, "VALIDATION_FAILED", "amountArs tiene que ser mayor que cero, con hasta 2 decimales");
  }
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
 * MOVO-312: "Pagar mi saldo" con Checkout Pro. El usuario paga a la cuenta de Movo, presente y en el navegador de
 * MP (el pago con tarjeta tokenizada a Movo no funciona todavía: falta la `public_key` de Movo S.A., MOVO-283).
 *
 * - **Idempotencia**: un índice único parcial (usuario + monto mientras `creating`/`pending`) hace que dos pedidos
 *   iguales en vuelo compartan un único intento y una única preferencia.
 * - **Plata una sola vez**: el movimiento `voluntary_payment` se asienta con la `idempotencyKey`
 *   `balance-payment:<intento>`; el estado del intento es informativo y no decide si se acredita.
 * - **Nada se confía del redirect ni del body del webhook**: el estado sale siempre de `Payment.get`/búsqueda con
 *   el token de Movo.
 */
export function createBalanceCheckoutService(deps: BalanceCheckoutDeps) {
  const { attempts, ledger, mercadoPago, alerts, log } = deps;
  const now = deps.now ?? (() => new Date());

  async function movoToken(): Promise<string> {
    try {
      return await deps.movoToken.getToken();
    } catch (error) {
      // Sin credenciales de Movo (`CARDS_NOT_CONFIGURED`) no hay checkout; el resto es MP caído.
      if (error instanceof ApiError && error.code === "CARDS_NOT_CONFIGURED") {
        throw new ApiError(503, "BALANCE_CHECKOUT_NOT_CONFIGURED", "El pago de saldo no está configurado en este ambiente.");
      }
      throw new ApiError(502, "PAYMENT_PROVIDER_ERROR", "No pudimos conectarnos con Mercado Pago. Probá de nuevo.");
    }
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
    const linked = await attempts.markApproved(attempt.id, paymentId);
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

  /** Aplica el estado de un pago de MP (ya consultado con el token de Movo) a su intento. */
  async function applyToAttempt(attempt: BalancePaymentAttempt, payment: PaymentSnapshot): Promise<BalancePaymentOutcome> {
    const status = payment.status ?? "";
    const paid = typeof payment.transaction_amount === "number" ? payment.transaction_amount : null;
    if (paid === null || new Prisma.Decimal(paid).toFixed(2) !== attempt.amountArs.toFixed(2)) {
      // La preferencia se crea con el monto exacto: que no coincida no es del flujo normal. No se acredita nada.
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

    if (status === "rejected" || status === "cancelled") {
      await attempts.closeOpen(attempt.id, "rejected");
      return "rejected";
    }
    // `pending`, `in_process`, `authorized`: todavía no hay resultado.
    return "waiting";
  }

  /**
   * Procesa un pago de MP que llegó por el webhook. `null` si no es de un intento de saldo (el `external_reference`
   * no es de ningún intento): el webhook sigue con el camino de los holds.
   */
  async function applyPayment(payment: PaymentSnapshot & { external_reference?: string | null }): Promise<BalancePaymentOutcome | null> {
    const reference = payment.external_reference;
    if (!reference || !UUID_RE.test(reference)) return null;
    const attempt = await attempts.findById(reference);
    if (!attempt) return null;
    return applyToAttempt(attempt, payment);
  }

  /**
   * Pone al día los intentos abiertos del usuario consultando a MP: un pago aprobado cuyo webhook no llegó se
   * acredita, y uno vencido sin pago se abandona. Una falla de MP no bloquea lo que el usuario está haciendo.
   */
  async function reconcileOpen(userId: string, token: string): Promise<void> {
    const open = await attempts.listOpenByUser(userId);
    for (const attempt of open) {
      try {
        const payments = await mercadoPago.searchPaymentsByExternalReference(token, attempt.id);
        const approved = payments.find((p) => p.status === "approved");
        if (approved) {
          await applyToAttempt(attempt, approved);
        } else if (attempt.status === "creating" && now().getTime() - attempt.createdAt.getTime() > STALE_CREATING_MS) {
          await attempts.closeOpen(attempt.id, "failed");
        } else if (attempt.status === "pending" && attempt.expiresAt.getTime() <= now().getTime()) {
          await attempts.closeOpen(attempt.id, "abandoned");
        }
      } catch (error) {
        log.warn({ attemptId: attempt.id, err: error instanceof Error ? error.message : String(error) }, "no se pudo conciliar un intento de pago de saldo");
      }
    }
  }

  async function createCheckout(userId: string, amountArs: number): Promise<CreateBalanceCheckoutResponse> {
    assertValidAmount(amountArs);
    const base = publicApiBase(deps.redirectUri);
    if (!base) {
      throw new ApiError(503, "BALANCE_CHECKOUT_NOT_CONFIGURED", "El pago de saldo no está configurado en este ambiente.");
    }
    const token = await movoToken();

    // Primero se concilia: un pago aprobado cuyo webhook se perdió baja la deuda antes de validar el monto.
    await reconcileOpen(userId, token);

    const { balanceArs } = await ledger.balance(userId);
    if (balanceArs <= 0) {
      throw new ApiError(422, "BALANCE_AMOUNT_EXCEEDS_DEBT", "No tenés deuda para pagar.");
    }
    if (amountArs > balanceArs) {
      throw new ApiError(422, "BALANCE_AMOUNT_EXCEEDS_DEBT", "El monto supera tu saldo deudor.");
    }

    const amount = new Prisma.Decimal(amountArs.toFixed(2));
    const expiresAt = new Date(now().getTime() + BALANCE_CHECKOUT_TTL_HOURS * 60 * 60 * 1000);
    let { attempt, created } = await attempts.insertOpen({ userId, amountArs: amount, expiresAt });

    if (!created) {
      // Otro pedido igual está en vuelo o ya tiene su checkout. Se reusa solo si sigue vigente.
      if (attempt.status === "pending" && attempt.checkoutUrl && attempt.expiresAt.getTime() > now().getTime()) {
        return { checkoutUrl: attempt.checkoutUrl, attemptId: attempt.id };
      }
      if (attempt.status === "creating" && now().getTime() - attempt.createdAt.getTime() <= STALE_CREATING_MS) {
        throw new ApiError(409, "BALANCE_CHECKOUT_IN_PROGRESS", "Estamos armando tu pago. Probá de nuevo en unos segundos.");
      }
      // Vencido o de un proceso caído: se descarta y se abre uno nuevo.
      await attempts.closeOpen(attempt.id, attempt.status === "creating" ? "failed" : "abandoned");
      ({ attempt, created } = await attempts.insertOpen({ userId, amountArs: amount, expiresAt }));
      if (!created) {
        throw new ApiError(409, "BALANCE_CHECKOUT_IN_PROGRESS", "Estamos armando tu pago. Probá de nuevo en unos segundos.");
      }
    }

    let preference;
    try {
      preference = await mercadoPago.createPreference(
        token,
        {
          items: [
            {
              id: attempt.id,
              title: "Saldo de Movo",
              description: "Pago de tu saldo en Movo",
              quantity: 1,
              unit_price: amountArs,
              currency_id: "ARS",
            },
          ],
          external_reference: attempt.id,
          back_urls: {
            success: `${base}/payments/balance/checkout/return?result=success`,
            failure: `${base}/payments/balance/checkout/return?result=failure`,
            pending: `${base}/payments/balance/checkout/return?result=pending`,
          },
          auto_return: "approved",
          notification_url: `${base}/payments/webhooks/mercadopago`,
          expires: true,
          expiration_date_to: expiresAt.toISOString(),
        },
        `movo-balance-checkout-${attempt.id}`
      );
    } catch (error) {
      await attempts.closeOpen(attempt.id, "failed");
      log.error({ attemptId: attempt.id, err: error instanceof Error ? error.message : String(error) }, "MP no creó la preferencia de pago de saldo");
      throw new ApiError(502, "PAYMENT_PROVIDER_ERROR", "No pudimos armar el pago. Probá de nuevo en unos minutos.");
    }

    const checkoutUrl = deps.testMode ? preference.sandbox_init_point : preference.init_point;
    if (!preference.id || !checkoutUrl) {
      await attempts.closeOpen(attempt.id, "failed");
      throw new ApiError(502, "PAYMENT_PROVIDER_ERROR", "Mercado Pago no devolvió el link de pago.");
    }
    await attempts.markPending(attempt.id, { mpPreferenceId: preference.id, checkoutUrl });
    log.info({ attemptId: attempt.id, userId, amountArs, preferenceId: preference.id }, "checkout de pago de saldo creado");
    return { checkoutUrl, attemptId: attempt.id };
  }

  return { createCheckout, applyPayment, reconcileOpen, movoToken };
}

export type BalanceCheckoutService = ReturnType<typeof createBalanceCheckoutService>;
