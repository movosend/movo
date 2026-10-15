import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

/**
 * MOVO-305 (spike): comportamiento de Mercado Pago que necesitan la penalidad de cancelación
 * (MOVO-226) y la cuenta corriente del usuario (MOVO-309/311/312). Pega DIRECTO a la API de
 * MP, sin pasar por el servicio: hoy la captura del servicio no admite un monto parcial.
 *
 * Es un test de OBSERVACIÓN: no afirma qué hace MP (eso es lo que se quiere averiguar), solo
 * que el setup funcione. Cada escenario anota lo que respondió MP y el resumen se imprime al
 * final, para copiarlo a `docs/payments/` y a Linear. Cada hold que queda autorizado se
 * libera en el mismo escenario.
 *
 * No corre en CI ni sin credenciales. Nada de esto se versiona, todo entra por entorno:
 *
 *   MP_SANDBOX_CARRIER_ACCESS_TOKEN   access_token `TEST-...` del Vendedor (como holds.sandbox)
 *   MP_SANDBOX_CARRIER_PUBLIC_KEY     public_key del mismo Vendedor
 *   MP_TEST_CARD_* / MP_TEST_PAYER_EMAIL / MP_TEST_PAYMENT_METHOD_ID   los del .env del spike
 *   MP_APP_CLIENT_ID / MP_APP_CLIENT_SECRET   app `movosend` (escenarios F y G, Movo como cobradora;
 *                                     también acepta MP_CLIENT_ID / MP_CLIENT_SECRET). El G solo
 *                                     necesita estas dos: corre aunque falten las del Vendedor
 *   MP_PUBLIC_KEY                     (opcional, escenario F) public_key `TEST-` para tokenizar
 *                                     el pago a Movo; sin ella se prueba con la del Vendedor
 *   MP_SANDBOX_BUYER_EMAIL            (opcional, escenario F) Comprador de prueba; si no, MP_TEST_PAYER_EMAIL
 *   MOVO_305_RESULTS_PATH             (opcional) archivo donde escribir el resumen en JSON (A-F)
 *
 * Ejemplo (desde services/movo-svc-payments):
 *   node --env-file=../../docs/payments/mercadopago-spike/.env \
 *     ../../node_modules/vitest/vitest.mjs run test/partial-capture.sandbox.test.ts
 * con las dos MP_SANDBOX_CARRIER_* exportadas en la shell.
 */
const MP_API = "https://api.mercadopago.com";
const CARRIER_TOKEN = process.env.MP_SANDBOX_CARRIER_ACCESS_TOKEN;
const CARRIER_PUBLIC_KEY = process.env.MP_SANDBOX_CARRIER_PUBLIC_KEY;
const CONFIGURED = Boolean(CARRIER_TOKEN && CARRIER_PUBLIC_KEY && process.env.MP_TEST_CARD_NUMBER);

const APP_CLIENT_ID = process.env.MP_APP_CLIENT_ID ?? process.env.MP_CLIENT_ID;
const APP_CLIENT_SECRET = process.env.MP_APP_CLIENT_SECRET ?? process.env.MP_CLIENT_SECRET;

const HOLD_AMOUNT = 1150;
const HOLD_FEE = 150;

interface MpResponse {
  status: number;
  body: Record<string, unknown>;
}

/** Lo que se le pide a cada respuesta de MP para el informe: lo que importa, sin tokens. */
function summarizePayment(body: Record<string, unknown>): Record<string, unknown> {
  return {
    id: body.id,
    status: body.status,
    status_detail: body.status_detail,
    captured: body.captured,
    transaction_amount: body.transaction_amount,
    transaction_amount_refunded: body.transaction_amount_refunded,
    net_received_amount: (body.transaction_details as Record<string, unknown> | undefined)?.net_received_amount,
    total_paid_amount: (body.transaction_details as Record<string, unknown> | undefined)?.total_paid_amount,
    fee_details: body.fee_details,
    // Errores de la API (400/4xx): MP los devuelve en estos campos.
    message: body.message,
    error: body.error,
    cause: body.cause,
  };
}

async function mp(method: string, path: string, token: string | null, payload?: unknown): Promise<MpResponse> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (method !== "GET") headers["X-Idempotency-Key"] = `movo-305-${randomUUID()}`;
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

describe.skipIf(!CONFIGURED)("spike MOVO-305: captura parcial y application_fee contra el sandbox de MP", () => {
  /** Hold como el de MOVO-209: `capture: false`, cobrado con el token del Vendedor. */
  async function createHold(amount: number, applicationFee: number): Promise<MpResponse> {
    const token = await tokenizeCard(CARRIER_PUBLIC_KEY!);
    expect(token.status, JSON.stringify(token.body)).toBe(201);
    return mp("POST", "/v1/payments", CARRIER_TOKEN!, {
      transaction_amount: amount,
      capture: false,
      installments: 1,
      token: token.body.id,
      payment_method_id: process.env.MP_TEST_PAYMENT_METHOD_ID ?? "visa",
      description: "MOVO-305 spike",
      external_reference: `movo-305-${randomUUID()}`,
      payer: { email: process.env.MP_TEST_PAYER_EMAIL },
      application_fee: applicationFee,
    });
  }

  async function getPayment(id: unknown): Promise<MpResponse> {
    return mp("GET", `/v1/payments/${String(id)}`, CARRIER_TOKEN!);
  }

  /** Libera lo que haya quedado autorizado: el spike no deja plata retenida. */
  async function releaseIfAuthorized(id: unknown): Promise<void> {
    const current = await getPayment(id);
    if (current.body.status === "authorized") {
      await mp("PUT", `/v1/payments/${String(id)}`, CARRIER_TOKEN!, { status: "cancelled" });
    }
  }

  afterAll(() => {
    const report = JSON.stringify(findings, null, 2);
    // vitest puede no mostrar el stdout de los hooks; con MOVO_305_RESULTS_PATH queda en un archivo.
    if (process.env.MOVO_305_RESULTS_PATH) writeFileSync(process.env.MOVO_305_RESULTS_PATH, report);
    console.log(`\n===== MOVO-305: resultados del sandbox =====\n${report}\n`);
  });

  it("A + B: captura parcial del 25 % y segundo intento de captura sobre el mismo pago", async () => {
    const hold = await createHold(HOLD_AMOUNT, HOLD_FEE);
    expect(hold.status, JSON.stringify(hold.body)).toBe(201);
    expect(hold.body.status).toBe("authorized");
    const id = hold.body.id;

    // A: penalidad de 25 % sobre $1.150. ¿Qué hace MP con el application_fee de 150?
    const partial = await mp("PUT", `/v1/payments/${String(id)}`, CARRIER_TOKEN!, {
      capture: true,
      transaction_amount: 287.5,
    });
    const afterPartial = await getPayment(id);
    findings.A_partial_capture_25_percent = {
      request: { holdAmount: HOLD_AMOUNT, applicationFee: HOLD_FEE, captureAmount: 287.5 },
      captureResponse: { httpStatus: partial.status, ...summarizePayment(partial.body) },
      paymentAfter: summarizePayment(afterPartial.body),
    };

    // B: ¿se puede volver a capturar (por ejemplo, otra parte) el mismo pago?
    const second = await mp("PUT", `/v1/payments/${String(id)}`, CARRIER_TOKEN!, {
      capture: true,
      transaction_amount: 100,
    });
    findings.B_second_capture = { httpStatus: second.status, ...summarizePayment(second.body) };

    await releaseIfAuthorized(id);
  }, 120_000);

  it("C: captura parcial por un monto MENOR que el application_fee", async () => {
    const hold = await createHold(HOLD_AMOUNT, HOLD_FEE);
    expect(hold.status, JSON.stringify(hold.body)).toBe(201);
    const id = hold.body.id;

    const partial = await mp("PUT", `/v1/payments/${String(id)}`, CARRIER_TOKEN!, {
      capture: true,
      transaction_amount: 100,
    });
    findings.C_capture_below_fee = {
      request: { holdAmount: HOLD_AMOUNT, applicationFee: HOLD_FEE, captureAmount: 100 },
      captureResponse: { httpStatus: partial.status, ...summarizePayment(partial.body) },
      paymentAfter: summarizePayment((await getPayment(id)).body),
    };

    await releaseIfAuthorized(id);
  }, 120_000);

  it("D: holds con application_fee del 30, 50, 90, 100 y 110 % del monto", async () => {
    const results: Record<string, unknown> = {};
    for (const ratio of [0.3, 0.5, 0.9, 1, 1.1]) {
      const amount = 1000;
      const fee = Math.round(amount * ratio * 100) / 100;
      const hold = await createHold(amount, fee);
      results[`${ratio * 100}%`] = { httpStatus: hold.status, ...summarizePayment(hold.body) };
      if (hold.body.id) await releaseIfAuthorized(hold.body.id);
    }
    findings.D_application_fee_ratios = results;
  }, 240_000);

  it("E: captura total de un hold con application_fee del 50 % (¿el split se aplica igual?)", async () => {
    const hold = await createHold(1000, 500);
    findings.E_full_capture_fee_50_percent = { holdHttpStatus: hold.status, hold: summarizePayment(hold.body) };
    if (hold.status !== 201 || hold.body.status !== "authorized") return;

    const captured = await mp("PUT", `/v1/payments/${String(hold.body.id)}`, CARRIER_TOKEN!, { capture: true });
    findings.E_full_capture_fee_50_percent = {
      holdHttpStatus: hold.status,
      captureResponse: { httpStatus: captured.status, ...summarizePayment(captured.body) },
      paymentAfter: summarizePayment((await getPayment(hold.body.id)).body),
    };
  }, 120_000);

  it.skipIf(!APP_CLIENT_ID || !APP_CLIENT_SECRET)(
    "F: pago directo a la cuenta de Movo (el usuario salda su deuda, MOVO-312)",
    async () => {
      const oauth = await mp("POST", "/oauth/token", null, {
        client_id: APP_CLIENT_ID,
        client_secret: APP_CLIENT_SECRET,
        grant_type: "client_credentials",
        test_token: true,
      });
      const movoToken = oauth.body.access_token;
      const tokenOk = typeof movoToken === "string" && movoToken.startsWith("TEST-");
      findings.F_movo_token = { httpStatus: oauth.status, isTestToken: tokenOk };
      if (!tokenOk) return;

      const publicKey = process.env.MP_PUBLIC_KEY ?? CARRIER_PUBLIC_KEY!;
      const card = await tokenizeCard(publicKey);
      const usedKey = process.env.MP_PUBLIC_KEY ? "MP_PUBLIC_KEY" : "MP_SANDBOX_CARRIER_PUBLIC_KEY";
      if (card.status !== 201) {
        findings.F_movo_collects = { usedPublicKey: usedKey, tokenizeHttpStatus: card.status, ...summarizePayment(card.body) };
        return;
      }

      const payment = await mp("POST", "/v1/payments", movoToken as string, {
        transaction_amount: 100,
        installments: 1,
        token: card.body.id,
        payment_method_id: process.env.MP_TEST_PAYMENT_METHOD_ID ?? "visa",
        description: "MOVO-305 spike: pago de saldo a Movo",
        external_reference: `movo-305-balance-${randomUUID()}`,
        payer: { email: process.env.MP_SANDBOX_BUYER_EMAIL ?? process.env.MP_TEST_PAYER_EMAIL },
      });
      findings.F_movo_collects = {
        usedPublicKey: usedKey,
        httpStatus: payment.status,
        ...summarizePayment(payment.body),
      };
    },
    120_000
  );
});

/** Token `TEST-` de Movo S.A. (ADR-039): `client_credentials` con `test_token`. */
async function movoTestToken(): Promise<MpResponse> {
  return mp("POST", "/oauth/token", null, {
    client_id: APP_CLIENT_ID,
    client_secret: APP_CLIENT_SECRET,
    grant_type: "client_credentials",
    test_token: true,
  });
}

describe.skipIf(!APP_CLIENT_ID || !APP_CLIENT_SECRET)("spike MOVO-305: Checkout Pro con Movo como cobradora", () => {
  // G: alternativa a F sin la public_key de Movo S.A. Solo crea la preferencia: el pago se
  // completa en el navegador (init_point) y eso no se automatiza acá.
  it("G: preferencia de Checkout Pro cobrada por Movo S.A. (pagar mi saldo, MOVO-312)", async () => {
    const oauth = await movoTestToken();
    const movoToken = oauth.body.access_token;
    expect(typeof movoToken === "string" && movoToken.startsWith("TEST-"), `oauth ${oauth.status}`).toBe(true);
    const movoUserId = oauth.body.user_id;

    const preference = await mp("POST", "/checkout/preferences", movoToken as string, {
      items: [{ title: "MOVO-305 spike: pago de saldo a Movo", quantity: 1, unit_price: 100, currency_id: "ARS" }],
      external_reference: `movo-305-balance-${randomUUID()}`,
    });
    const result = {
      httpStatus: preference.status,
      collectorIsMovo: preference.body.collector_id === movoUserId,
      hasInitPoint: typeof preference.body.init_point === "string",
      hasSandboxInitPoint: typeof preference.body.sandbox_init_point === "string",
    };
    console.log(`\n===== MOVO-305 G =====\n${JSON.stringify(result, null, 2)}\n`);

    expect(preference.status, JSON.stringify(preference.body)).toBe(201);
    expect(preference.body.collector_id).toBe(movoUserId);
    expect(typeof preference.body.init_point).toBe("string");
  }, 60_000);
});
