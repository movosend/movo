import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import type { AlertNotifier } from "../src/adapters/alert-notifier";
import type { MercadoPagoClient } from "../src/adapters/mercadopago-client";
import { createCarrierMpAccountRepository } from "../src/repositories/carrier-mp-account-repository";
import { fingerprintOf } from "../src/repositories/user-ledger-repository";
import { createTokenCipher } from "../src/utils/token-cipher";

// MOVO-336: integración contra Postgres y Redis reales (convención del repo); solo se reemplazan los bordes
// externos: MP y el canal de alertas. El reembolso real contra el sandbox es `refund.sandbox.test.ts` (Paso 0).

const SHIPMENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CARRIER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ADMIN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
const MP_PAYMENT = "1352823085";
const REFUND_URL = (shipmentId = SHIPMENT) => `/internal/payments/settlements/by-shipment/${shipmentId}/refund`;
const REFUNDS_URL = (shipmentId = SHIPMENT) => `/internal/payments/settlements/by-shipment/${shipmentId}/refunds`;

/** Un error como los del SDK de MP: `Error` con `status` y las causas en `causes`. */
function mpError(status: number | undefined, message: string, causes: Array<{ code: string }> = []) {
  return Object.assign(new Error(message), { ...(status !== undefined ? { status } : {}), causes });
}

function mpRefund(overrides: Record<string, unknown> = {}) {
  return {
    id: 987654,
    payment_id: Number(MP_PAYMENT),
    amount: 1000,
    status: "approved",
    date_created: "2026-10-25T15:00:00.000-04:00",
    refund_mode: "standard",
    // `source` trae el nombre de quien inició el reembolso: no tiene que llegar a la base.
    source: { id: "1000000001", name: "Juan Pérez", type: "collector" },
    ...overrides,
  };
}

describe("reembolso de un pago capturado (MOVO-336)", () => {
  let app: FastifyInstance;
  const mp = {
    createPayment: vi.fn(),
    getPayment: vi.fn(),
    capturePayment: vi.fn(),
    cancelPayment: vi.fn(),
    searchPaymentsByExternalReference: vi.fn(async () => []),
    refundPayment: vi.fn(async (_token: string, _id: string, _opts: { idempotencyKey: string; amount?: number }) => mpRefund()),
  };
  const alerts = { send: vi.fn(async () => undefined) };

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL ??= "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL ??= "redis://localhost:6379";
    process.env.MP_TOKEN_ENCRYPTION_KEY = ENCRYPTION_KEY;
    process.env.MP_WEBHOOK_SWEEP_ENABLED = "false";
    app = buildApp({
      mercadoPagoClient: mp as unknown as MercadoPagoClient,
      alertNotifier: alerts as unknown as AlertNotifier,
      captureRetrySweepEnabled: false,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.MP_TOKEN_ENCRYPTION_KEY;
    delete process.env.MP_WEBHOOK_SWEEP_ENABLED;
  });

  async function linkCarrier(tokenExpiresAt = new Date(Date.now() + 86_400_000)) {
    await createCarrierMpAccountRepository(app.db, createTokenCipher(ENCRYPTION_KEY)).upsertLinked(
      CARRIER,
      {
        mpUserId: "1000000001",
        email: "vendedor@example.com",
        nickname: "VENDEDOR",
        accessToken: "TEST-access-secret",
        refreshToken: "TG-refresh-secret",
        publicKey: "TEST-public-key",
        scope: "offline_access",
        tokenExpiresAt,
      },
      new Date()
    );
  }

  beforeEach(async () => {
    await app.db.$executeRawUnsafe(
      "TRUNCATE TABLE payments.user_ledger_entries, payments.settlements, payments.holds, payments.carrier_mp_accounts CASCADE"
    );
    vi.clearAllMocks();
    mp.refundPayment.mockReset().mockImplementation(async () => mpRefund());
    await linkCarrier();
  });

  /** Hold capturado y liquidación acreditada por $1.000 (lo capturado, tope de los reembolsos). */
  async function seedCaptured(settlementStatus: "credited" | "processing" | "failed" | "escalated" = "credited") {
    const hold = await app.db.hold.create({
      data: {
        shipmentId: SHIPMENT,
        attempt: 1,
        carrierId: CARRIER,
        collectorId: "1000000001",
        mpPaymentId: MP_PAYMENT,
        amountArs: 1000,
        applicationFeeArs: 150,
        baseAmountArs: 1000,
        commissionArs: 150,
        status: "captured",
      },
    });
    return app.db.settlement.create({
      data: {
        shipmentId: SHIPMENT,
        holdId: hold.id,
        carrierId: CARRIER,
        mpPaymentId: MP_PAYMENT,
        grossAmountArs: 1000,
        commissionArs: 150,
        mpFeeArs: 41,
        netAmountArs: 809,
        status: settlementStatus,
        capturedAt: new Date(),
      },
    });
  }

  const refund = (body: Record<string, unknown> = {}, shipmentId = SHIPMENT) =>
    app.inject({
      method: "POST",
      url: REFUND_URL(shipmentId),
      payload: { reason: "Disputa resuelta a favor del emisor", idempotencyKey: "dispute-1", adminId: ADMIN, ...body },
    });
  const rows = () => app.db.refund.findMany({ orderBy: { attempt: "asc" } });
  const ledger = () => app.db.userLedgerEntry.findMany({ where: { userId: CARRIER } });

  describe("reembolso exitoso", () => {
    it("sin monto reembolsa el total capturado, con el token del transportista y la key de MP del intento", async () => {
      const settlement = await seedCaptured();

      const res = await refund();

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        replayed: false,
        refund: {
          settlementId: settlement.id,
          shipmentId: SHIPMENT,
          attempt: 1,
          amountArs: 1000,
          status: "succeeded",
          failureReason: null,
          mpRefundId: "987654",
          ledgerEntryId: null,
        },
      });
      expect(mp.refundPayment).toHaveBeenCalledTimes(1);
      expect(mp.refundPayment).toHaveBeenCalledWith("TEST-access-secret", MP_PAYMENT, {
        idempotencyKey: `movo-refund-${settlement.id}-1`,
        amount: 1000,
      });
      expect(alerts.send).not.toHaveBeenCalled();
      expect(await ledger()).toEqual([]);
      // La fecha del movimiento en el historial es explícita, no `updated_at`.
      expect((await rows())[0].completedAt).not.toBeNull();
    });

    it("guarda la respuesta de MP sin datos sensibles (sin `source`)", async () => {
      await seedCaptured();

      await refund();

      const [row] = await rows();
      expect(row.mpResponse).toEqual({
        id: 987654,
        payment_id: Number(MP_PAYMENT),
        amount: 1000,
        status: "approved",
        date_created: "2026-10-25T15:00:00.000-04:00",
        refund_mode: "standard",
      });
      expect(JSON.stringify(row)).not.toContain("Juan");
    });

    it("con monto hace un reembolso parcial y deja el resto reembolsable", async () => {
      await seedCaptured();
      mp.refundPayment.mockImplementation(async () => mpRefund({ amount: 300 }));

      const res = await refund({ amountArs: 300 });

      expect(res.json().refund).toMatchObject({ amountArs: 300, status: "succeeded" });
      expect(mp.refundPayment).toHaveBeenCalledWith(expect.any(String), MP_PAYMENT, expect.objectContaining({ amount: 300 }));
      const list = await app.inject({ method: "GET", url: REFUNDS_URL() });
      expect(list.statusCode).toBe(200);
      expect(list.json().refundableArs).toBe(700);
      expect(list.json().refunds).toHaveLength(1);
    });

    it("varios parciales con distinta key suman; el que se pasa del tope es 422 con lo reembolsable y no toca a MP", async () => {
      const settlement = await seedCaptured();

      expect((await refund({ amountArs: 300, idempotencyKey: "k1" })).statusCode).toBe(200);
      const tooMuch = await refund({ amountArs: 800, idempotencyKey: "k2" });

      expect(tooMuch.statusCode).toBe(422);
      expect(tooMuch.json().error).toMatchObject({ code: "REFUND_AMOUNT_EXCEEDS_REFUNDABLE", details: { refundableArs: 700 } });
      expect(mp.refundPayment).toHaveBeenCalledTimes(1);
      expect(await rows()).toHaveLength(1);

      // Sin monto = lo que queda; el segundo intento de la liquidación usa el `<n>` siguiente.
      const rest = await refund({ idempotencyKey: "k3" });
      expect(rest.json().refund).toMatchObject({ attempt: 2, amountArs: 700, status: "succeeded" });
      expect(mp.refundPayment).toHaveBeenLastCalledWith(expect.any(String), MP_PAYMENT, {
        idempotencyKey: `movo-refund-${settlement.id}-2`,
        amount: 700,
      });

      // Ya no queda nada: ni un reembolso total ni uno parcial.
      for (const body of [{ idempotencyKey: "k4" }, { amountArs: 1, idempotencyKey: "k5" }]) {
        const res = await refund(body);
        expect(res.statusCode).toBe(422);
        expect(res.json().error).toMatchObject({ code: "REFUND_AMOUNT_EXCEEDS_REFUNDABLE", details: { refundableArs: 0 } });
      }
      expect(mp.refundPayment).toHaveBeenCalledTimes(2);
    });
  });

  describe("liquidación no reembolsable", () => {
    it("sin liquidación es 404 SETTLEMENT_NOT_FOUND", async () => {
      const res = await refund();
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("SETTLEMENT_NOT_FOUND");
    });

    it.each(["processing", "failed", "escalated"] as const)("una liquidación %s es 409 SETTLEMENT_NOT_REFUNDABLE", async (status) => {
      await seedCaptured(status);

      const res = await refund();

      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("SETTLEMENT_NOT_REFUNDABLE");
      expect(mp.refundPayment).not.toHaveBeenCalled();
      expect(await rows()).toEqual([]);
    });
  });

  describe("idempotencia", () => {
    it("un reintento con la misma key devuelve el reembolso hecho sin volver a pegarle a MP", async () => {
      await seedCaptured();

      const first = await refund({ amountArs: 400 });
      const again = await refund({ amountArs: 400 });
      const third = await refund({ amountArs: 400 });

      expect(first.json().replayed).toBe(false);
      for (const res of [again, third]) {
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ replayed: true, refund: { id: first.json().refund.id, status: "succeeded" } });
      }
      expect(mp.refundPayment).toHaveBeenCalledTimes(1);
      expect(await rows()).toHaveLength(1);
    });

    it("también sin monto (total): el reintento no recalcula lo reembolsable", async () => {
      await seedCaptured();

      const first = await refund();
      const again = await refund();

      expect(again.json()).toMatchObject({ replayed: true, refund: { id: first.json().refund.id, amountArs: 1000 } });
      expect(mp.refundPayment).toHaveBeenCalledTimes(1);
    });

    it("dos pedidos a la vez con la misma key dejan UNA fila y le pegan UNA vez a MP", async () => {
      await seedCaptured();

      const results = await Promise.all([refund({ amountArs: 250 }), refund({ amountArs: 250 })]);

      // Uno hace el reembolso. El otro, o lo encuentra hecho (200 replayed) o recibe 409 REFUND_IN_PROGRESS sin tocar a MP:
      // nunca llama a MP en paralelo, que respondería un 409 propio y se leería como un reembolso sin confirmar.
      const statuses = results.map((res) => res.statusCode).sort();
      expect(statuses[0]).toBe(200);
      for (const res of results.filter((r) => r.statusCode !== 200)) {
        expect(res.statusCode).toBe(409);
        expect(res.json().error.code).toBe("REFUND_IN_PROGRESS");
      }
      const all = await rows();
      expect(all).toHaveLength(1);
      expect(all[0].status).toBe("succeeded");
      expect(mp.refundPayment).toHaveBeenCalledTimes(1);
      expect(alerts.send).not.toHaveBeenCalled();
    });

    it("la misma key con otro monto o con otro motivo es 409 REFUND_IDEMPOTENCY_CONFLICT", async () => {
      await seedCaptured();
      await refund({ amountArs: 400 });

      const otherAmount = await refund({ amountArs: 500 });
      const otherReason = await refund({ amountArs: 400, reason: "Otro motivo distinto" });

      for (const res of [otherAmount, otherReason]) {
        expect(res.statusCode).toBe(409);
        expect(res.json().error.code).toBe("REFUND_IDEMPOTENCY_CONFLICT");
      }
      expect(mp.refundPayment).toHaveBeenCalledTimes(1);
      expect(await rows()).toHaveLength(1);
    });
  });

  describe("saldo insuficiente del transportista (AC4)", () => {
    const noBalance = () => mpError(400, "Insufficient funds to refund the payment");

    it("no reintenta contra MP: asienta la deuda en la cuenta corriente, queda fallback_to_ledger y alerta", async () => {
      const settlement = await seedCaptured();
      mp.refundPayment.mockRejectedValue(noBalance());

      const res = await refund({ amountArs: 600 });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.refund).toMatchObject({ status: "fallback_to_ledger", failureReason: "insufficient_balance", amountArs: 600 });
      expect(body.refund.ledgerEntryId).toEqual(expect.any(String));
      expect(mp.refundPayment).toHaveBeenCalledTimes(1);

      const entries = await ledger();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        id: body.refund.ledgerEntryId,
        type: "manual_adjustment",
        status: "pending",
        shipmentId: SHIPMENT,
        holdId: settlement.holdId,
        paymentId: MP_PAYMENT,
        adminId: ADMIN,
      });
      // Positivo = el transportista debe, y se cobra como cualquier deuda (MOVO-311/312/313).
      expect(entries[0].amountArs.toNumber()).toBe(600);
      expect(entries[0].reason).toContain("Disputa resuelta a favor del emisor");
      expect(alerts.send).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "refund_fallback_to_ledger",
          context: expect.objectContaining({ shipmentId: SHIPMENT, carrierId: CARRIER, amountArs: 600 }),
        })
      );
    });

    it("un reintento no suma la deuda dos veces ni vuelve a MP", async () => {
      await seedCaptured();
      mp.refundPayment.mockRejectedValue(noBalance());
      const first = await refund({ amountArs: 600 });

      const again = await refund({ amountArs: 600 });

      expect(again.json()).toMatchObject({ replayed: true, refund: { id: first.json().refund.id, status: "fallback_to_ledger" } });
      expect(mp.refundPayment).toHaveBeenCalledTimes(1);
      expect(await ledger()).toHaveLength(1);
    });

    it("el monto en fallback sigue contando contra el tope: no se puede compensar dos veces", async () => {
      await seedCaptured();
      mp.refundPayment.mockRejectedValue(noBalance());
      await refund({ amountArs: 600, idempotencyKey: "k1" });

      const list = (await app.inject({ method: "GET", url: REFUNDS_URL() })).json();
      expect(list.refundableArs).toBe(400);
      const tooMuch = await refund({ amountArs: 500, idempotencyKey: "k2" });
      expect(tooMuch.statusCode).toBe(422);
      expect(tooMuch.json().error.details).toEqual({ refundableArs: 400 });
    });

    it("un 403 `insufficient permissions` no es falta de saldo: son credenciales rechazadas", async () => {
      await seedCaptured();
      mp.refundPayment.mockRejectedValue(mpError(403, "Insufficient permissions to refund"));

      const res = await refund();

      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("CARRIER_MP_ACCOUNT_NOT_LINKED");
      expect(await ledger()).toEqual([]);
    });
  });

  describe("fallos (AC5): nunca se descartan en silencio", () => {
    it("un rechazo de MP deja el intento failed, consultable y con alerta; el reintento abre un intento nuevo con otra key de MP", async () => {
      const settlement = await seedCaptured();
      mp.refundPayment.mockRejectedValueOnce(mpError(400, "refund amount invalid", [{ code: "2000" }]));

      const failed = await refund({ amountArs: 400 });

      expect(failed.statusCode).toBe(502);
      expect(failed.json().error.code).toBe("PAYMENT_PROVIDER_ERROR");
      const [row] = await rows();
      expect(row).toMatchObject({ status: "failed", failureReason: "provider_rejected", attempt: 1 });
      expect(row.lastError).toContain("refund amount invalid");
      expect(row.completedAt).not.toBeNull();
      // Un 4xx que no se reconoce como falta de saldo alerta aparte y trae lo que dijo MP: puede SER falta de saldo
      // con otro texto (Paso 0 pendiente), y en ese caso no quedó la deuda del transportista.
      expect(alerts.send).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "refund_rejected_unrecognized",
          context: expect.objectContaining({ shipmentId: SHIPMENT, attempt: 1, mpHttpStatus: 400, mpCauseCodes: "2000" }),
        })
      );
      expect(alerts.send).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "refund_failed" }));
      // Consultable, y lo fallido no cuenta contra el tope.
      const list = (await app.inject({ method: "GET", url: REFUNDS_URL() })).json();
      expect(list.refunds).toEqual([expect.objectContaining({ attempt: 1, status: "failed", failureReason: "provider_rejected" })]);
      expect(list.refundableArs).toBe(1000);

      // Reintento con la misma key: intento 2 con otra key hacia MP (la del 1 tiene cacheado el rechazo).
      const retry = await refund({ amountArs: 400 });

      expect(retry.statusCode).toBe(200);
      expect(retry.json()).toMatchObject({ replayed: false, refund: { attempt: 2, status: "succeeded" } });
      expect(mp.refundPayment).toHaveBeenLastCalledWith(expect.any(String), MP_PAYMENT, {
        idempotencyKey: `movo-refund-${settlement.id}-2`,
        amount: 400,
      });
      expect(await rows()).toHaveLength(2);
    });

    it("una falla de red no prueba que MP no reembolsó: queda processing con alerta y el reintento reusa la key de MP", async () => {
      const settlement = await seedCaptured();
      mp.refundPayment.mockRejectedValueOnce(mpError(undefined, "fetch failed"));

      const lost = await refund({ amountArs: 400 });

      expect(lost.statusCode).toBe(502);
      expect((await rows())[0]).toMatchObject({ status: "processing", attempt: 1 });
      expect(alerts.send).toHaveBeenCalledWith(expect.objectContaining({ kind: "refund_unconfirmed" }));

      const retry = await refund({ amountArs: 400 });

      expect(retry.statusCode).toBe(200);
      expect(retry.json().refund).toMatchObject({ attempt: 1, status: "succeeded" });
      expect(await rows()).toHaveLength(1);
      const keys = mp.refundPayment.mock.calls.map((call) => call[2].idempotencyKey);
      expect(keys).toEqual([`movo-refund-${settlement.id}-1`, `movo-refund-${settlement.id}-1`]);
    });

    it.each([500, 429, 409])("un %s de MP también deja el intento processing, no failed", async (status) => {
      await seedCaptured();
      mp.refundPayment.mockRejectedValueOnce(mpError(status, "try later"));

      const res = await refund();

      expect(res.statusCode).toBe(502);
      expect((await rows())[0].status).toBe("processing");
    });

    it("credenciales rechazadas por MP (401): failed carrier_account_unavailable y 409 CARRIER_MP_ACCOUNT_NOT_LINKED", async () => {
      await seedCaptured();
      mp.refundPayment.mockRejectedValueOnce(mpError(401, "invalid access token"));

      const res = await refund();

      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("CARRIER_MP_ACCOUNT_NOT_LINKED");
      expect((await rows())[0]).toMatchObject({ status: "failed", failureReason: "carrier_account_unavailable" });
      expect(alerts.send).toHaveBeenCalledWith(expect.objectContaining({ kind: "refund_failed" }));
    });

    it("sin cuenta de MP vinculada ni se llama a MP: failed y 409", async () => {
      await seedCaptured();
      await app.db.$executeRawUnsafe("TRUNCATE TABLE payments.carrier_mp_accounts");

      const res = await refund();

      expect(res.statusCode).toBe(409);
      expect(mp.refundPayment).not.toHaveBeenCalled();
      expect((await rows())[0]).toMatchObject({ status: "failed", failureReason: "carrier_account_unavailable" });
    });

    it("token de MP vencido: no se llama a MP", async () => {
      await seedCaptured();
      await linkCarrier(new Date(Date.now() - 60_000));

      const res = await refund();

      expect(res.statusCode).toBe(409);
      expect(mp.refundPayment).not.toHaveBeenCalled();
    });

    it("MP responde 2xx pero con el reembolso rechazado: failed unexpected_refund_status", async () => {
      await seedCaptured();
      mp.refundPayment.mockResolvedValueOnce(mpRefund({ status: "rejected" }));

      const res = await refund();

      expect(res.statusCode).toBe(502);
      expect((await rows())[0]).toMatchObject({ status: "failed", failureReason: "unexpected_refund_status", mpRefundId: "987654" });
    });

    it("MP lo aceptó pero sigue en curso (in_process): queda processing con su id y el reintento lo completa", async () => {
      await seedCaptured();
      mp.refundPayment.mockResolvedValueOnce(mpRefund({ status: "in_process" }));

      const pending = await refund();

      expect(pending.statusCode).toBe(200);
      expect(pending.json().refund).toMatchObject({ status: "processing", mpRefundId: "987654" });
      // Cuenta contra el tope mientras no se resuelve.
      expect((await app.inject({ method: "GET", url: REFUNDS_URL() })).json().refundableArs).toBe(0);

      const done = await refund();

      expect(done.json()).toMatchObject({ replayed: false, refund: { attempt: 1, status: "succeeded" } });
      expect(await rows()).toHaveLength(1);
    });

    it("una alerta que falla no rompe el reembolso", async () => {
      await seedCaptured();
      mp.refundPayment.mockRejectedValueOnce(mpError(400, "refund amount invalid"));
      alerts.send.mockRejectedValueOnce(new Error("telegram caído"));

      const res = await refund();

      // El error que ve el llamador es el del reembolso, no el de la alerta.
      expect(res.statusCode).toBe(502);
      expect(res.json().error.code).toBe("PAYMENT_PROVIDER_ERROR");
      expect((await rows())[0].status).toBe("failed");
    });
  });

  describe("reintento de un intento ambiguo (review de PR #314)", () => {
    const REASON = "Disputa resuelta a favor del emisor";

    /** Un intento `processing` como el que deja un reembolso sin confirmar, con la huella que calcularía el pedido. */
    async function seedProcessing(
      settlementId: string,
      holdId: string,
      overrides: { createdAt?: Date; updatedAt?: Date; lastError?: string | null } = {}
    ) {
      return app.db.refund.create({
        data: {
          settlementId,
          shipmentId: SHIPMENT,
          holdId,
          carrierId: CARRIER,
          mpPaymentId: MP_PAYMENT,
          attempt: 1,
          amountArs: 400,
          reason: REASON,
          requestKey: "dispute-1",
          requestFingerprint: fingerprintOf({ amount: "400.00", reason: REASON }),
          adminId: ADMIN,
          mpIdempotencyKey: `movo-refund-${settlementId}-1`,
          status: "processing",
          lastError: overrides.lastError === undefined ? null : overrides.lastError,
          ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
          ...(overrides.updatedAt ? { updatedAt: overrides.updatedAt } : {}),
        },
      });
    }

    it("credenciales vencidas al reintentar un processing: sigue processing (pudo haberse hecho en MP), no abre otro intento", async () => {
      const settlement = await seedCaptured();
      mp.refundPayment.mockRejectedValueOnce(mpError(undefined, "fetch failed"));
      await refund({ amountArs: 400 });
      expect((await rows())[0].status).toBe("processing");
      alerts.send.mockClear();
      await linkCarrier(new Date(Date.now() - 60_000));

      const retry = await refund({ amountArs: 400 });

      expect(retry.statusCode).toBe(409);
      expect(retry.json().error.code).toBe("CARRIER_MP_ACCOUNT_NOT_LINKED");
      expect(mp.refundPayment).toHaveBeenCalledTimes(1);
      expect(await rows()).toHaveLength(1);
      expect((await rows())[0].status).toBe("processing");
      expect(alerts.send).toHaveBeenCalledWith(expect.objectContaining({ kind: "refund_unconfirmed" }));
      expect(alerts.send).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "refund_failed" }));

      // Re-vinculada la cuenta, el siguiente reintento retoma el MISMO intento con la MISMA key de MP: no hay doble reembolso.
      await linkCarrier();
      const resumed = await refund({ amountArs: 400 });

      expect(resumed.statusCode).toBe(200);
      expect(resumed.json().refund).toMatchObject({ attempt: 1, status: "succeeded" });
      expect(await rows()).toHaveLength(1);
      expect(mp.refundPayment).toHaveBeenLastCalledWith(expect.any(String), MP_PAYMENT, {
        idempotencyKey: `movo-refund-${settlement.id}-1`,
        amount: 400,
      });
    });

    it("sin cuenta de MP vinculada al reintentar un processing: tampoco se da por fallido", async () => {
      await seedCaptured();
      mp.refundPayment.mockRejectedValueOnce(mpError(500, "boom"));
      await refund({ amountArs: 400 });
      await app.db.$executeRawUnsafe("TRUNCATE TABLE payments.carrier_mp_accounts");

      const retry = await refund({ amountArs: 400 });

      expect(retry.statusCode).toBe(409);
      expect((await rows())[0].status).toBe("processing");
    });

    it("un 401 de MP al reintentar un processing: sigue processing; en un intento recién creado sí es failed", async () => {
      await seedCaptured();
      mp.refundPayment.mockRejectedValueOnce(mpError(undefined, "fetch failed")).mockRejectedValueOnce(mpError(401, "invalid access token"));
      await refund({ amountArs: 400 });

      const retry = await refund({ amountArs: 400 });

      expect(retry.statusCode).toBe(409);
      expect(retry.json().error.code).toBe("CARRIER_MP_ACCOUNT_NOT_LINKED");
      expect((await rows())[0].status).toBe("processing");
      expect(await rows()).toHaveLength(1);
    });

    it("un intento que otro pedido está procesando (processing sin last_error, reciente): 409 REFUND_IN_PROGRESS y no se llama a MP", async () => {
      const settlement = await seedCaptured();
      await seedProcessing(settlement.id, settlement.holdId);

      const res = await refund({ amountArs: 400 });

      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("REFUND_IN_PROGRESS");
      expect(mp.refundPayment).not.toHaveBeenCalled();
      expect(alerts.send).not.toHaveBeenCalled();
    });

    it("si el pedido que lo manejaba se cayó (processing sin last_error y pasado el plazo), se retoma con la misma key", async () => {
      const settlement = await seedCaptured();
      await seedProcessing(settlement.id, settlement.holdId, { updatedAt: new Date(Date.now() - 5 * 60_000) });

      const res = await refund({ amountArs: 400 });

      expect(res.statusCode).toBe(200);
      expect(res.json().refund).toMatchObject({ attempt: 1, status: "succeeded" });
      expect(mp.refundPayment).toHaveBeenCalledWith(expect.any(String), MP_PAYMENT, {
        idempotencyKey: `movo-refund-${settlement.id}-1`,
        amount: 400,
      });
    });

    it("un processing con last_error (el anterior terminó sin confirmar) se retoma enseguida, sin esperar el plazo", async () => {
      const settlement = await seedCaptured();
      await seedProcessing(settlement.id, settlement.holdId, { lastError: "fetch failed" });

      const res = await refund({ amountArs: 400 });

      expect(res.statusCode).toBe(200);
      expect(res.json().refund.status).toBe("succeeded");
    });

    it("un processing más viejo de lo que MP garantiza la key no se reintenta: REFUND_NEEDS_REVIEW, alerta y no toca a MP", async () => {
      const settlement = await seedCaptured();
      await seedProcessing(settlement.id, settlement.holdId, {
        createdAt: new Date(Date.now() - 13 * 60 * 60 * 1000),
        lastError: "fetch failed",
      });

      const res = await refund({ amountArs: 400 });

      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("REFUND_NEEDS_REVIEW");
      expect(mp.refundPayment).not.toHaveBeenCalled();
      expect((await rows())[0].status).toBe("processing");
      expect(alerts.send).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "refund_needs_review", context: expect.objectContaining({ shipmentId: SHIPMENT }) })
      );
    });
  });

  describe("validación del pedido", () => {
    it.each([
      ["sin idempotencyKey", { idempotencyKey: undefined }],
      ["sin adminId", { adminId: undefined }],
      ["sin reason", { reason: undefined }],
      ["reason demasiado corto", { reason: "ab" }],
      ["adminId que no es uuid", { adminId: "no-es-uuid" }],
      ["amountArs en cero", { amountArs: 0 }],
      ["amountArs negativo", { amountArs: -5 }],
      ["campo desconocido", { amount: 5 }],
    ])("%s es 400", async (_name, override) => {
      await seedCaptured();

      const res = await refund(override);

      expect(res.statusCode).toBe(400);
      expect(mp.refundPayment).not.toHaveBeenCalled();
      expect(await rows()).toEqual([]);
    });

    it("un monto con más de dos decimales es 400", async () => {
      await seedCaptured();
      const res = await refund({ amountArs: 100.123 });
      expect(res.statusCode).toBe(400);
    });

    it("el listado de un envío sin liquidación es 404", async () => {
      const res = await app.inject({ method: "GET", url: REFUNDS_URL() });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("SETTLEMENT_NOT_FOUND");
    });
  });
});
