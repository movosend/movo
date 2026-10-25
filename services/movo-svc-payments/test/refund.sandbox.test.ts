import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

/**
 * MOVO-336, Paso 0: comportamiento de Mercado Pago ante un reembolso de un pago ya capturado en el modelo
 * Marketplace (pago creado con el token del transportista y `application_fee` de Movo). Pega DIRECTO a la API de
 * MP: lo que se quiere averiguar es qué responde MP, no qué hace el servicio.
 *
 * Es un test de OBSERVACIÓN, como `partial-capture.sandbox.test.ts`: no afirma qué hace MP, solo que el setup
 * funcione. Cada escenario anota lo que respondió y el resumen se imprime al final (y va a un archivo con
 * `MOVO_336_RESULTS_PATH`), para transcribirlo al ticket y a `docs/payments/`. Todo lo que se cobra se reembolsa
 * o se libera en el mismo escenario.
 *
 * Lo que tiene que contestar (los tres puntos del Paso 0):
 *   1. Reembolso total y parcial con `POST /v1/payments/:id/refunds` y el token del transportista (A, B).
 *   2. ¿MP devuelve el `application_fee` de Movo en el reembolso total y cómo lo prorratea en el parcial? (A, B:
 *      `fee_details` y `net_received_amount` antes y después; y el desglose de `charges_details`).
 *   3. ¿Qué responde si el transportista no tiene saldo suficiente? (D) De ahí sale el código de causa que falta en
 *      `INSUFFICIENT_BALANCE_CAUSES` (`src/modules/settlements/refund-failure.ts`): hoy se reconoce por el mensaje.
 *   Más: reembolsar de más (C) y repetir la misma key (E, la idempotencia de MP que usa el servicio).
 *
 * No corre en CI ni sin credenciales. Nada de esto se versiona, todo entra por entorno (los mismos nombres que el
 * spike de MOVO-305):
 *
 *   MP_SANDBOX_CARRIER_ACCESS_TOKEN   access_token `TEST-...` del Vendedor
 *   MP_SANDBOX_CARRIER_PUBLIC_KEY     public_key del mismo Vendedor
 *   MP_TEST_CARD_* / MP_TEST_PAYER_EMAIL / MP_TEST_PAYMENT_METHOD_ID   los del .env del spike
 *   MOVO_336_RESULTS_PATH             (opcional) archivo donde escribir el resumen en JSON
 *
 * Ejemplo (desde services/movo-svc-payments):
 *   node --env-file=../../docs/payments/mercadopago-spike/.env \
 *     ../../node_modules/vitest/vitest.mjs run test/refund.sandbox.test.ts
 * con las dos MP_SANDBOX_CARRIER_* exportadas en la shell.
 */
const MP_API = "https://api.mercadopago.com";
const CARRIER_TOKEN = process.env.MP_SANDBOX_CARRIER_ACCESS_TOKEN;
const CARRIER_PUBLIC_KEY = process.env.MP_SANDBOX_CARRIER_PUBLIC_KEY;
const CONFIGURED = Boolean(CARRIER_TOKEN && CARRIER_PUBLIC_KEY && process.env.MP_TEST_CARD_NUMBER);

const HOLD_AMOUNT = 1150;
const HOLD_FEE = 150;

interface MpResponse {
  status: number;
  body: Record<string, unknown>;
}

/** Lo que importa de cada respuesta de MP para el informe, sin tokens ni datos personales. */
function summarizePayment(body: Record<string, unknown>): Record<string, unknown> {
  const details = body.transaction_details as Record<string, unknown> | undefined;
  return {
    id: body.id,
    status: body.status,
    status_detail: body.status_detail,
    captured: body.captured,
    transaction_amount: body.transaction_amount,
    transaction_amount_refunded: body.transaction_amount_refunded,
    net_received_amount: details?.net_received_amount,
    total_paid_amount: details?.total_paid_amount,
    fee_details: body.fee_details,
    charges_details: body.charges_details,
    // Errores de la API (4xx): MP los devuelve en estos campos.
    message: body.message,
    error: body.error,
    cause: body.cause,
  };
}

/** Un reembolso: sin `source` (nombre de quien lo inició). */
function summarizeRefund(body: Record<string, unknown>): Record<string, unknown> {
  return {
    id: body.id,
    payment_id: body.payment_id,
    amount: body.amount,
    status: body.status,
    refund_mode: body.refund_mode,
    adjustment_amount: body.adjustment_amount,
    amount_refunded_to_payer: body.amount_refunded_to_payer,
    message: body.message,
    error: body.error,
    cause: body.cause,
  };
}

async function mp(
  method: string,
  path: string,
  token: string | null,
  payload?: unknown,
  idempotencyKey?: string
): Promise<MpResponse> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (method !== "GET") headers["X-Idempotency-Key"] = idempotencyKey ?? `movo-336-${randomUUID()}`;
  const response = await fetch(`${MP_API}${path}`, {
    method,
    headers,
    body: payload === undefined ? undefined : JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    body = { raw: text };
  }
  return { status: response.status, body };
}

/** Lo que hace el mobile: tokenizar con la public_key de quien cobra, sin Authorization. */
async function tokenizeCard(publicKey: string): Promise<MpResponse> {
  return mp("POST", `/v1/card_tokens?public_key=${encodeURIComponent(publicKey)}`, null, {
    card_number: process.env.MP_TEST_CARD_NUMBER,
    security_code: process.env.MP_TEST_CARD_CVV,
    expiration_month: Number(process.env.MP_TEST_CARD_EXP_MONTH),
    expiration_year: Number(process.env.MP_TEST_CARD_EXP_YEAR),
    cardholder: {
      name: process.env.MP_TEST_CARD_HOLDER_NAME ?? "APRO",
      identification: { type: "DNI", number: "12345678" },
    },
  });
}

const findings: Record<string, unknown> = {};

describe.skipIf(!CONFIGURED)("Paso 0 de MOVO-336: reembolsos de un pago capturado contra el sandbox de MP", () => {
  /** Hold + captura total, como la entrega (MOVO-212): el pago queda `approved` con el `application_fee` aplicado. */
  async function createCapturedPayment(amount = HOLD_AMOUNT, applicationFee = HOLD_FEE): Promise<MpResponse> {
    const token = await tokenizeCard(CARRIER_PUBLIC_KEY!);
    expect(token.status, JSON.stringify(token.body)).toBe(201);
    const hold = await mp("POST", "/v1/payments", CARRIER_TOKEN!, {
      transaction_amount: amount,
      capture: false,
      installments: 1,
      token: token.body.id,
      payment_method_id: process.env.MP_TEST_PAYMENT_METHOD_ID ?? "visa",
      description: "MOVO-336 paso 0",
      external_reference: `movo-336-${randomUUID()}`,
      payer: { email: process.env.MP_TEST_PAYER_EMAIL },
      application_fee: applicationFee,
    });
    expect(hold.status, JSON.stringify(hold.body)).toBe(201);
    const captured = await mp("PUT", `/v1/payments/${String(hold.body.id)}`, CARRIER_TOKEN!, { capture: true });
    expect(captured.status, JSON.stringify(captured.body)).toBe(200);
    return captured;
  }

  const getPayment = (id: unknown) => mp("GET", `/v1/payments/${String(id)}`, CARRIER_TOKEN!);
  const refund = (id: unknown, amount?: number, key?: string) =>
    mp("POST", `/v1/payments/${String(id)}/refunds`, CARRIER_TOKEN!, amount === undefined ? {} : { amount }, key);

  afterAll(() => {
    const report = JSON.stringify(findings, null, 2);
    // vitest puede no mostrar el stdout de los hooks; con MOVO_336_RESULTS_PATH queda en un archivo.
    if (process.env.MOVO_336_RESULTS_PATH) writeFileSync(process.env.MOVO_336_RESULTS_PATH, report);
    console.log(`\n===== MOVO-336: resultados del sandbox =====\n${report}\n`);
  });

  it("A: reembolso TOTAL (sin amount): ¿MP devuelve el application_fee de Movo?", async () => {
    const captured = await createCapturedPayment();
    const id = captured.body.id;

    const result = await refund(id);
    const after = await getPayment(id);
    findings.A_total_refund = {
      request: { holdAmount: HOLD_AMOUNT, applicationFee: HOLD_FEE },
      paymentBeforeRefund: summarizePayment(captured.body),
      refundResponse: { httpStatus: result.status, ...summarizeRefund(result.body) },
      paymentAfter: summarizePayment(after.body),
    };
  }, 120_000);

  it("B: reembolso PARCIAL del 25 %: ¿cómo prorratea MP el application_fee?", async () => {
    const captured = await createCapturedPayment();
    const id = captured.body.id;

    const result = await refund(id, 287.5);
    const after = await getPayment(id);
    findings.B_partial_refund_25_percent = {
      request: { holdAmount: HOLD_AMOUNT, applicationFee: HOLD_FEE, refundAmount: 287.5 },
      paymentBeforeRefund: summarizePayment(captured.body),
      refundResponse: { httpStatus: result.status, ...summarizeRefund(result.body) },
      paymentAfter: summarizePayment(after.body),
    };

    // Un segundo parcial sobre el mismo pago: lo que MP acumula y cómo cambia el desglose.
    const second = await refund(id, 300);
    findings.B_second_partial_refund = {
      refundResponse: { httpStatus: second.status, ...summarizeRefund(second.body) },
      paymentAfter: summarizePayment((await getPayment(id)).body),
    };
  }, 120_000);

  it("C: reembolsar MÁS de lo capturado (o de lo que queda)", async () => {
    const captured = await createCapturedPayment();
    const id = captured.body.id;

    const tooMuch = await refund(id, HOLD_AMOUNT + 100);
    await refund(id, 1000);
    const exceedsRemaining = await refund(id, 200);
    findings.C_refund_exceeds = {
      moreThanCaptured: { httpStatus: tooMuch.status, ...summarizeRefund(tooMuch.body) },
      moreThanRemaining: { httpStatus: exceedsRemaining.status, ...summarizeRefund(exceedsRemaining.body) },
    };
  }, 120_000);

  // El caso que define el fallback (AC4): el transportista sin saldo. En el sandbox el dinero recién capturado queda
  // pendiente de liberación en la cuenta del vendedor; este escenario pide el reembolso apenas después de capturar y
  // anota la respuesta. Si el sandbox no reproduce la falta de saldo, hay que provocarla a mano (retirar o gastar el
  // saldo de la cuenta de prueba del Vendedor) y volver a correrlo. LO IMPORTANTE a transcribir: `httpStatus`,
  // `message`, `error` y `cause[].code` — de ahí sale `INSUFFICIENT_BALANCE_CAUSES`.
  it("D: reembolso con el transportista SIN SALDO suficiente", async () => {
    const captured = await createCapturedPayment(HOLD_AMOUNT * 20, HOLD_FEE);
    const id = captured.body.id;

    const result = await refund(id);
    findings.D_carrier_without_balance = {
      note: "Si httpStatus es 201 el sandbox no reprodujo la falta de saldo: vaciar la cuenta del Vendedor y repetir.",
      refundResponse: { httpStatus: result.status, ...summarizeRefund(result.body) },
      paymentAfter: summarizePayment((await getPayment(id)).body),
    };
  }, 120_000);

  it("E: repetir el reembolso con la MISMA key de idempotencia (lo que hace el servicio ante una respuesta perdida)", async () => {
    const captured = await createCapturedPayment();
    const id = captured.body.id;
    const key = `movo-336-idem-${randomUUID()}`;

    const first = await refund(id, 100, key);
    const again = await refund(id, 100, key);
    const list = await mp("GET", `/v1/payments/${String(id)}/refunds`, CARRIER_TOKEN!);
    findings.E_same_idempotency_key = {
      first: { httpStatus: first.status, ...summarizeRefund(first.body) },
      again: { httpStatus: again.status, ...summarizeRefund(again.body) },
      sameRefundId: first.body.id === again.body.id,
      refundsOnPayment: Array.isArray(list.body) ? list.body.length : list.body,
    };
  }, 120_000);
});
