import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHash } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import { ApiError, CLOSED_HOLD_STATUSES, LIVE_HOLD_STATUSES } from "@movo/shared";
import {
  classifyCreateError,
  createHoldService,
  HoldServiceDeps,
  failureReasonFromStatusDetail,
  holdUpdateFromPayment,
  readMpError,
  STALE_CREATING_MS,
} from "../src/modules/holds/hold.service";
import type { MercadoPagoClient, PaymentResponse } from "../src/adapters/mercadopago-client";
import type { CarrierMpAccountRepository } from "../src/repositories/carrier-mp-account-repository";
import {
  Hold,
  HoldAttemptConflictError,
  HoldRepository,
  HoldUpdate,
  NewHoldAttempt,
} from "../src/repositories/hold-repository";

// Todos los ids son ficticios: nada de cuentas reales de sandbox en fixtures versionados.
const SHIPMENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CARRIER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER_CARRIER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MP_USER = "1000000001";
// MOVO-282: el emisor, su tarjeta guardada (id interno) y los ids de MP que nunca deben salir.
const PAYER_USER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SAVED_CARD = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const OTHER_SAVED_CARD = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const MP_CUSTOMER = "customer-mp-secret-1";
const MP_CARD = "card-mp-secret-1";
const PAYER_EMAIL = "comprador@example.com";
const NOW = new Date("2026-10-10T12:00:00.000Z");

/** Repo en memoria con la misma semántica de unicidad que la base real. */
const dec = (value: number) => ({ toNumber: () => value });

class MemoryHoldRepository implements HoldRepository {
  rows: Hold[] = [];
  /** MOVO-311: saldo de la cuenta corriente por usuario que ve `plan` al crear un intento. */
  balances = new Map<string, number>();
  private seq = 0;

  async findLatestByShipment(shipmentId: string) {
    const own = this.rows.filter((r) => r.shipmentId === shipmentId).sort((a, b) => b.attempt - a.attempt);
    return own[0] ?? null;
  }

  async createAttempt(data: NewHoldAttempt) {
    const clash = this.rows.some(
      (r) =>
        r.shipmentId === data.shipmentId &&
        (r.attempt === data.attempt || LIVE_HOLD_STATUSES.includes(r.status))
    );
    if (clash) throw new HoldAttemptConflictError();
    const amounts = data.plan({
      carrierBalanceArs: this.balances.get(data.carrierId) ?? 0,
      payerBalanceArs: data.payerId ? (this.balances.get(data.payerId) ?? 0) : 0,
    });
    const row = {
      id: `00000000-0000-4000-8000-${String(++this.seq).padStart(12, "0")}`,
      shipmentId: data.shipmentId,
      attempt: data.attempt,
      carrierId: data.carrierId,
      collectorId: data.collectorId,
      mpPaymentId: null,
      amountArs: dec(amounts.amountArs),
      applicationFeeArs: dec(amounts.applicationFeeArs),
      baseAmountArs: dec(amounts.baseAmountArs),
      commissionArs: dec(amounts.commissionArs),
      debtOffsetArs: dec(amounts.debtOffsetArs),
      debtSurchargeArs: dec(amounts.debtSurchargeArs),
      status: "creating",
      statusDetail: null,
      failureReason: null,
      requestFingerprint: data.requestFingerprint,
      savedCardId: data.savedCardId ?? null,
      payerId: data.payerId ?? null,
      cardLast4: null,
      cardBrand: null,
      mpFeeArs: null,
      expiresAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    } as unknown as Hold;
    this.rows.push(row);
    return row;
  }

  async update(id: string, patch: HoldUpdate) {
    const row = this.rows.find((r) => r.id === id) as Hold;
    const { mpFeeArs, ...rest } = patch;
    Object.assign(row, rest, mpFeeArs === undefined ? {} : { mpFeeArs: dec(mpFeeArs) });
    return row;
  }

  async markCaptured(id: string, patch: { statusDetail: string | null }) {
    const row = this.rows.find((r) => r.id === id);
    if (row?.status !== "authorized") return false;
    Object.assign(row, { status: "captured", statusDetail: patch.statusDetail, expiresAt: null });
    return true;
  }
}

const credentials = () => ({
  mpUserId: MP_USER,
  accessToken: "TEST-access",
  refreshToken: "TG-refresh",
  publicKey: "TEST-public-key",
});

function payment(overrides: Record<string, unknown> = {}): PaymentResponse {
  return { id: 5550001, status: "authorized", status_detail: "pending_capture", ...overrides } as PaymentResponse;
}

function silentLog() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe("failureReasonFromStatusDetail (AC5 de MOVO-209)", () => {
  it.each([
    ["cc_rejected_insufficient_amount", "insufficient_funds"],
    ["cc_rejected_bad_filled_card_number", "invalid_data"],
    ["cc_rejected_bad_filled_security_code", "invalid_data"],
    ["cc_rejected_other_reason", "card_rejected"],
    ["cc_rejected_call_for_authorize", "card_rejected"],
    ["cc_rejected_high_risk", "card_rejected"],
    ["rejected_by_regulations", "platform_error"],
    ["algo_desconocido", "platform_error"],
    [null, "platform_error"],
  ])("%s → %s", (detail, expected) => {
    expect(failureReasonFromStatusDetail(detail)).toBe(expected);
  });
});

describe("readMpError: forma real del error del SDK (verificado en sandbox el 14/10/2026)", () => {
  // El SDK 3.x tira una instancia de Error con `status`, `error` y las causas en `causes`.
  class SdkBadRequestError extends Error {
    status = 400;
    error = "bad_request";
    causes = [{ code: "3031", description: "security_code_id can't be null" }];
  }

  it("lee las causas de `causes` (SDK) y de `cause` (cuerpo crudo de la API)", () => {
    const sdk = readMpError(Object.assign(new SdkBadRequestError("security_code_id can't be null")));
    expect(sdk).toEqual({ status: 400, causeCodes: ["3031"], message: "security_code_id can't be null" });
    expect(readMpError({ status: 400, message: "x", cause: [{ code: 2006 }] }).causeCodes).toEqual(["2006"]);
  });

  it("con el error real del SDK, un CVV ausente (3031) se clasifica como rechazo y no como transitorio", () => {
    const info = readMpError(new SdkBadRequestError("security_code_id can't be null"));
    expect(classifyCreateError(info)).toEqual({ kind: "rejected", failureReason: "invalid_data" });
  });

  it("un Error común (timeout, red) no trae causas", () => {
    expect(readMpError(new Error("The operation was aborted"))).toMatchObject({ status: undefined, causeCodes: [] });
  });
});

describe("classifyCreateError (review de PR #226, punto 2)", () => {
  const info = (status: number | undefined, causeCodes: string[] = []) => ({ status, causeCodes, message: "x" });

  it("solo un 400/422 con causa conocida cierra el intento", () => {
    expect(classifyCreateError(info(400, ["2006"]))).toEqual({ kind: "rejected", failureReason: "invalid_data" });
    expect(classifyCreateError(info(422, ["3003"]))).toEqual({ kind: "rejected", failureReason: "invalid_data" });
    // MOVO-282: CVV ausente o vacío (3031) y de largo inválido (3032) con tarjeta guardada.
    expect(classifyCreateError(info(400, ["3031"]))).toEqual({ kind: "rejected", failureReason: "invalid_data" });
    expect(classifyCreateError(info(400, ["3032"]))).toEqual({ kind: "rejected", failureReason: "invalid_data" });
    expect(classifyCreateError(info(400, ["2034"]))).toEqual({ kind: "rejected", failureReason: "platform_error" });
  });

  it("401/403 son del token del transportista, no un rechazo", () => {
    expect(classifyCreateError(info(401))).toEqual({ kind: "carrier_auth" });
    expect(classifyCreateError(info(403))).toEqual({ kind: "carrier_auth" });
  });

  it.each([
    ["timeout de MP", 408, []],
    ["idempotencia en curso", 409, []],
    ["rate limit", 429, []],
    ["error de servidor", 503, []],
    ["red caída (sin status)", undefined, []],
    ["400 con una causa que no conocemos", 400, ["9999"]],
    ["404", 404, []],
  ])("%s es transitorio: no prueba que MP no creó el pago", (_label, status, codes) => {
    expect(classifyCreateError(info(status as number | undefined, codes as string[]))).toEqual({ kind: "transient" });
  });
});

describe("holdUpdateFromPayment: tarjeta del pago (MOVO-302)", () => {
  const patchOf = (p: Record<string, unknown>) =>
    holdUpdateFromPayment(p as Parameters<typeof holdUpdateFromPayment>[0], null, NOW, 5);

  it("toma marca y últimos 4 del pago, en cualquier estado conocido", () => {
    for (const status of ["authorized", "in_process", "approved", "cancelled", "rejected"]) {
      expect(patchOf({ id: 1, status, payment_method_id: "visa", card: { last_four_digits: "4242" } })).toMatchObject({
        cardLast4: "4242",
        cardBrand: "visa",
      });
    }
  });

  it("sin tarjeta en el pago el parche no trae esas claves: no pisa un dato previo", () => {
    const patch = patchOf({ id: 1, status: "authorized" }) as Record<string, unknown>;
    expect(patch).not.toHaveProperty("cardLast4");
    expect(patch).not.toHaveProperty("cardBrand");
  });

  it("descarta lo que no tiene la forma esperada y normaliza la marca a minúsculas", () => {
    const bad = patchOf({
      id: 1,
      status: "authorized",
      payment_method_id: "visa; drop table",
      card: { last_four_digits: "12ab" },
    }) as Record<string, unknown>;
    expect(bad).not.toHaveProperty("cardLast4");
    expect(bad).not.toHaveProperty("cardBrand");
    expect(patchOf({ id: 1, status: "authorized", payment_method_id: "MASTER" })).toMatchObject({ cardBrand: "master" });
  });

  it("un estado desconocido sigue devolviendo null (no se toca la fila)", () => {
    expect(patchOf({ id: 1, status: "charged_back", card: { last_four_digits: "4242" } })).toBeNull();
  });
});

describe("holdUpdateFromPayment: comisión real de MP (MOVO-285)", () => {
  const patchOf = (p: Record<string, unknown>) =>
    holdUpdateFromPayment(p as Parameters<typeof holdUpdateFromPayment>[0], null, NOW, 5);
  const charge = (original: number, from = "collector") => ({
    name: "mercadopago_fee",
    accounts: { from, to: "mp" },
    amounts: { original, refunded: 0 },
  });

  it("al crear el hold toma el mercadopago_fee de charges_details", () => {
    expect(patchOf({ id: 1, status: "authorized", charges_details: [charge(41)] })).toMatchObject({ mpFeeArs: 41 });
  });

  it("tras capturar toma el de fee_details y no cuenta el application_fee ni el del pagador", () => {
    const patch = patchOf({
      id: 1,
      status: "approved",
      fee_details: [
        { type: "mercadopago_fee", amount: 41.25, fee_payer: "collector" },
        { type: "application_fee", amount: 150, fee_payer: "collector" },
        { type: "financing_fee", amount: 9, fee_payer: "payer" },
      ],
    });
    expect(patch).toMatchObject({ mpFeeArs: 41.25 });
  });

  it("sin desglose, con un cargo del pagador o con un monto inválido no trae la clave (no pisa un valor previo)", () => {
    for (const p of [
      { id: 1, status: "authorized" },
      { id: 1, status: "authorized", charges_details: [] },
      { id: 1, status: "authorized", charges_details: [charge(41, "payer")] },
      { id: 1, status: "authorized", charges_details: [charge(-1)] },
      { id: 1, status: "authorized", charges_details: [charge(10.123)] },
    ]) {
      expect(patchOf(p)).not.toHaveProperty("mpFeeArs");
    }
  });
});

describe("estados de hold (review de PR #226, punto 7)", () => {
  it("vivo y cerrado particionan todos los estados, sin repetir", () => {
    expect([...LIVE_HOLD_STATUSES, ...CLOSED_HOLD_STATUSES].sort()).toEqual(
      ["authorized", "cancelled", "captured", "creating", "in_process", "rejected"].sort()
    );
    expect(CLOSED_HOLD_STATUSES.filter((s) => LIVE_HOLD_STATUSES.includes(s))).toEqual([]);
    expect([...CLOSED_HOLD_STATUSES].sort()).toEqual(["cancelled", "rejected"]);
  });
});

describe("HoldService (MOVO-209)", () => {
  let holds: MemoryHoldRepository;
  let mp: { [K in keyof MercadoPagoClient]: ReturnType<typeof vi.fn> };
  let accounts: { findActiveCredentials: ReturnType<typeof vi.fn>; findCredentials: ReturnType<typeof vi.fn> };
  let savedCards: { findLive: ReturnType<typeof vi.fn>; findCustomer: ReturnType<typeof vi.fn> };
  let log: ReturnType<typeof silentLog>;
  let clock: Date;

  function service(holdValidityDays = 5) {
    return createHoldService({
      holdValidityDays,
      debtCollectionMaxRate: 0.3,
      ledgerBalance: async (userId) => holds.balances.get(userId) ?? 0,
      holds,
      accounts: accounts as unknown as CarrierMpAccountRepository,
      mercadoPago: mp as unknown as MercadoPagoClient,
      savedCards: savedCards as unknown as HoldServiceDeps["savedCards"],
      log: log as unknown as FastifyBaseLogger,
      now: () => clock,
    });
  }

  const input = {
    shipmentId: SHIPMENT,
    carrierId: CARRIER,
    cardToken: "card-token-secret",
    amountArs: 1150,
    payerEmail: PAYER_EMAIL,
    payerUserId: PAYER_USER,
    paymentMethodId: "visa",
  };

  /** Deja el intento 1 en `creating` simulando un timeout de MP. */
  async function leaveCreating(svc = service()) {
    mp.createPayment.mockRejectedValueOnce(new Error("The operation was aborted"));
    await expect(svc.create(input)).rejects.toMatchObject({ statusCode: 502 });
    expect(holds.rows[0].status).toBe("creating");
  }

  beforeEach(() => {
    clock = NOW;
    log = silentLog();
    holds = new MemoryHoldRepository();
    mp = {
      createPayment: vi.fn(async () => payment()),
      getPayment: vi.fn(async () => payment()),
      capturePayment: vi.fn(),
      cancelPayment: vi.fn(async () => payment({ status: "cancelled", status_detail: "by_collector" })),
      searchPaymentsByExternalReference: vi.fn(async () => []),
    };
    accounts = {
      findActiveCredentials: vi.fn(async () => credentials()),
      findCredentials: vi.fn(async () => credentials()),
    };
    // Por defecto la tarjeta guardada existe, es del emisor y su customer está en MP.
    savedCards = {
      findLive: vi.fn(async (userId: string, id: string) =>
        userId === PAYER_USER && (id === SAVED_CARD || id === OTHER_SAVED_CARD) ? { id, userId, mpCardId: MP_CARD } : null
      ),
      findCustomer: vi.fn(async (userId: string) =>
        userId === PAYER_USER ? { userId, mpCustomerId: MP_CUSTOMER } : null
      ),
    };
  });

  describe("deuda de la cuenta corriente en el hold (MOVO-311)", () => {
    it("transportista con deuda: sube el application_fee y el emisor paga lo mismo", async () => {
      holds.balances.set(CARRIER, 100);
      const { hold } = await service().create(input);

      const [, body] = mp.createPayment.mock.calls[0];
      expect(body).toMatchObject({ transaction_amount: 1150, application_fee: 250 });
      expect(hold).toMatchObject({ amountArs: 1150, commissionArs: 150, debtOffsetArs: 100, debtSurchargeArs: 0 });
    });

    it("deuda mayor al tope: se descuenta el 30% del precio y el resto queda pendiente", async () => {
      holds.balances.set(CARRIER, 1000);
      const { hold } = await service().create(input);
      expect(hold).toMatchObject({ applicationFeeArs: 495, debtOffsetArs: 345 });
    });

    it("emisor con deuda: el monto sube y el fee lleva el recargo menos la comisión de MP que absorbe Movo", async () => {
      holds.balances.set(PAYER_USER, 200);
      const { hold } = await service().create(input);

      const [, body] = mp.createPayment.mock.calls[0];
      expect(body).toMatchObject({ transaction_amount: 1350, application_fee: 340.02 });
      expect(hold).toMatchObject({ baseAmountArs: 1150, amountArs: 1350, debtSurchargeArs: 200 });
    });

    it("un saldo a favor no descuenta nada", async () => {
      holds.balances.set(CARRIER, -500).set(PAYER_USER, -500);
      await service().create(input);
      const [, body] = mp.createPayment.mock.calls[0];
      expect(body).toMatchObject({ transaction_amount: 1150, application_fee: 150 });
    });

    it("el replay de un hold con recargo compara contra el precio, no contra el monto cobrado", async () => {
      holds.balances.set(PAYER_USER, 200);
      const svc = service();
      await svc.create(input);
      const second = await svc.create(input);
      expect(second.replayed).toBe(true);
      expect(mp.createPayment).toHaveBeenCalledTimes(1);
    });

    it("un reintento de un creating reusa los montos del intento aunque la deuda haya cambiado", async () => {
      holds.balances.set(PAYER_USER, 200);
      const svc = service();
      await leaveCreating(svc);
      holds.balances.set(PAYER_USER, 50);
      await svc.create(input);

      const [, first] = mp.createPayment.mock.calls[0];
      const [, retry] = mp.createPayment.mock.calls[1];
      expect(retry.transaction_amount).toBe(first.transaction_amount);
      expect(retry.application_fee).toBe(first.application_fee);
      expect(mp.createPayment.mock.calls[1][2]).toBe(mp.createPayment.mock.calls[0][2]);
    });

    it("la vista previa del transportista usa el mismo tope por precio", async () => {
      holds.balances.set(CARRIER, 400);
      const preview = await service().previewCarrierDebt(CARRIER, [1150, 500]);
      expect(preview).toEqual({ pendingBalanceArs: 400, debtOffsetsArs: [345, 150] });
    });
  });

  describe("tarjeta guardada (MOVO-282, ADR-039)", () => {
    const withCard = { ...input, savedCardId: SAVED_CARD };

    it("AC1: el pagador pasa a ser el customer de la tarjeta, no el email", async () => {
      const { hold } = await service().create(withCard);

      const [, body] = mp.createPayment.mock.calls[0];
      expect(body.payer).toEqual({ type: "customer", id: MP_CUSTOMER });
      expect(body.payer).not.toHaveProperty("email");
      // El token (card_id + CVV) sigue siendo el mismo campo de siempre.
      expect(body).toMatchObject({ token: "card-token-secret", capture: false, application_fee: 150 });
      expect(hold.status).toBe("authorized");
      expect(savedCards.findLive).toHaveBeenCalledWith(PAYER_USER, SAVED_CARD);
      expect(savedCards.findCustomer).toHaveBeenCalledWith(PAYER_USER);
    });

    it("AC3: persiste la tarjeta en el hold (habilita el 409 CARD_IN_USE)", async () => {
      await service().create(withCard);
      expect((holds.rows[0] as unknown as { savedCardId: string }).savedCardId).toBe(SAVED_CARD);
    });

    it("sin savedCardId sigue el camino de siempre: payer con email y sin leer tarjetas", async () => {
      await service().create(input);

      const [, body] = mp.createPayment.mock.calls[0];
      expect(body.payer).toEqual({ email: PAYER_EMAIL });
      expect(savedCards.findLive).not.toHaveBeenCalled();
      expect(savedCards.findCustomer).not.toHaveBeenCalled();
      expect((holds.rows[0] as unknown as { savedCardId: string | null }).savedCardId).toBeNull();
    });

    it.each([
      ["de otro usuario", { findLive: async () => null }],
      ["dada de baja", { findLive: async () => null }],
      ["con el emisor sin customer en MP", { findCustomer: async () => null }],
    ])("AC2: una tarjeta %s responde 404 sin abrir intento ni llamar a MP", async (_label, override) => {
      Object.assign(savedCards, Object.fromEntries(Object.entries(override).map(([k, fn]) => [k, vi.fn(fn)])));

      await expect(service().create(withCard)).rejects.toMatchObject({ statusCode: 404, code: "SAVED_CARD_NOT_FOUND" });

      expect(mp.createPayment).not.toHaveBeenCalled();
      expect(accounts.findActiveCredentials).not.toHaveBeenCalled();
      expect(holds.rows).toHaveLength(0);
    });

    it("AC2: la tarjeta de otro usuario no se distingue de una inexistente", async () => {
      const other = await service()
        .create({ ...withCard, payerUserId: "99999999-9999-4999-8999-999999999999" })
        .catch((e) => e);
      const missing = await service()
        .create({ ...withCard, savedCardId: "00000000-0000-4000-8000-00000000000a" })
        .catch((e) => e);
      expect({ statusCode: other.statusCode, code: other.code, message: other.message }).toEqual({
        statusCode: missing.statusCode,
        code: missing.code,
        message: missing.message,
      });
    });

    it("AC2: la respuesta no expone customer_id ni card_id de MP", async () => {
      const { hold } = await service().create(withCard);
      const serialized = JSON.stringify(hold);
      expect(serialized).not.toContain(MP_CUSTOMER);
      expect(serialized).not.toContain(MP_CARD);
      expect(hold).not.toHaveProperty("savedCardId");
    });

    it("los logs no incluyen customer_id, card_id ni el token (AC9)", async () => {
      await service().create(withCard);
      const logged = JSON.stringify([log.info.mock.calls, log.warn.mock.calls, log.error.mock.calls, log.debug.mock.calls]);
      expect(logged).not.toContain(MP_CUSTOMER);
      expect(logged).not.toContain(MP_CARD);
      expect(logged).not.toContain("card-token-secret");
    });

    describe("AC4: request_fingerprint incluye savedCardId", () => {
      it("sin tarjeta guardada la huella es la de siempre (no rompe intentos en curso)", async () => {
        await service().create(input);
        const legacy = createHash("sha256")
          .update(JSON.stringify(["card-token-secret", PAYER_EMAIL.toLowerCase(), "visa"]))
          .digest("hex");
        expect(holds.rows[0].requestFingerprint).toBe(legacy);
      });

      it("con tarjeta guardada la huella cambia y sigue siendo un hash sin el token ni el id", async () => {
        await service().create(withCard);
        const fingerprint = holds.rows[0].requestFingerprint as string;
        expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
        expect(fingerprint).not.toContain("card-token-secret");
        expect(fingerprint).not.toContain(SAVED_CARD);
        const legacy = createHash("sha256")
          .update(JSON.stringify(["card-token-secret", PAYER_EMAIL.toLowerCase(), "visa"]))
          .digest("hex");
        expect(fingerprint).not.toBe(legacy);
      });

      it("el reintento con la MISMA tarjeta sobre un creating reusa la idempotency key", async () => {
        mp.createPayment.mockRejectedValueOnce(new Error("The operation was aborted"));
        await expect(service().create(withCard)).rejects.toMatchObject({ statusCode: 502 });

        await service().create(withCard);

        expect(holds.rows).toHaveLength(1);
        expect(mp.createPayment.mock.calls[1][2]).toBe(`movo-hold-${SHIPMENT}-1`);
      });

      it("el reintento con OTRA tarjeta guardada no reusa la key del intento anterior", async () => {
        mp.createPayment.mockRejectedValueOnce(new Error("The operation was aborted"));
        await expect(service().create(withCard)).rejects.toMatchObject({ statusCode: 502 });

        await service().create({ ...withCard, savedCardId: OTHER_SAVED_CARD });

        expect(holds.rows).toHaveLength(2);
        expect(holds.rows[0]).toMatchObject({ status: "rejected", statusDetail: "superseded" });
        expect(mp.createPayment.mock.calls[1][2]).toBe(`movo-hold-${SHIPMENT}-2`);
      });

      it("pasar de tarjeta guardada a tarjeta completa tampoco reusa la key", async () => {
        mp.createPayment.mockRejectedValueOnce(new Error("The operation was aborted"));
        await expect(service().create(withCard)).rejects.toMatchObject({ statusCode: 502 });

        await service().create(input);

        expect(mp.createPayment.mock.calls[1][2]).toBe(`movo-hold-${SHIPMENT}-2`);
        expect(mp.createPayment.mock.calls[1][1].payer).toEqual({ email: PAYER_EMAIL });
      });
    });

    describe("rechazos de MP con tarjeta guardada (AC6/AC7)", () => {
      it("CVV incorrecto no es un error HTTP: vuelve como rejected/invalid_data", async () => {
        mp.createPayment.mockResolvedValue(
          payment({ status: "rejected", status_detail: "cc_rejected_bad_filled_security_code" })
        );
        const { hold } = await service().create(withCard);
        expect(hold).toMatchObject({
          status: "rejected",
          statusDetail: "cc_rejected_bad_filled_security_code",
          failureReason: "invalid_data",
        });
      });

      it("fondos insuficientes (titular FUND) → insufficient_funds", async () => {
        mp.createPayment.mockResolvedValue(payment({ status: "rejected", status_detail: "cc_rejected_insufficient_amount" }));
        const { hold } = await service().create(withCard);
        expect(hold.failureReason).toBe("insufficient_funds");
      });

      it("tarjeta guardada vencida: el emisor no tipeó la fecha, así que es card_rejected", async () => {
        mp.createPayment.mockResolvedValue(payment({ status: "rejected", status_detail: "cc_rejected_bad_filled_date" }));
        const { hold } = await service().create(withCard);
        expect(hold.failureReason).toBe("card_rejected");
      });

      it("la misma fecha mal cargada con tarjeta completa sigue siendo invalid_data", async () => {
        mp.createPayment.mockResolvedValue(payment({ status: "rejected", status_detail: "cc_rejected_bad_filled_date" }));
        const { hold } = await service().create(input);
        expect(hold.failureReason).toBe("invalid_data");
      });

      it.each([["2006"], ["3001"], ["3003"], ["3031"], ["3032"]])(
        "token vencido o ya usado, o CVV ausente/de largo inválido (%s), cierra el intento como rejected, sin pasar por el 502",
        async (code) => {
          mp.createPayment.mockRejectedValueOnce({ status: 400, message: "Card token", cause: [{ code }] });
          const { hold } = await service().create(withCard);
          expect(hold).toMatchObject({ status: "rejected", failureReason: "invalid_data", statusDetail: `mp_error_${code}` });
        }
      );
    });

    it("AC8: liberar el hold de una tarjeta guardada cancela con el token del transportista y no toca la tarjeta", async () => {
      await service().create(withCard);
      const released = await service().release(SHIPMENT);

      expect(released.status).toBe("cancelled");
      expect(mp.cancelPayment).toHaveBeenCalledWith("TEST-access", "5550001", expect.stringContaining("movo-hold-release-"));
      expect(accounts.findCredentials).toHaveBeenCalledWith(CARRIER);
      // La tarjeta guardada no se consulta ni se modifica al liberar.
      expect(savedCards.findLive).toHaveBeenCalledTimes(1);
    });
  });

  describe("pagador y tarjeta para el historial (MOVO-302)", () => {
    type HistoryRow = { payerId: string | null; cardLast4: string | null; cardBrand: string | null };
    const row = () => holds.rows[0] as unknown as HistoryRow;

    it("AC3: persiste al emisor (payerUserId) como pagador del hold, con tarjeta completa o guardada", async () => {
      await service().create(input);
      expect(row().payerId).toBe(PAYER_USER);

      holds = new MemoryHoldRepository();
      await service().create({ ...input, savedCardId: SAVED_CARD });
      expect(row().payerId).toBe(PAYER_USER);
    });

    it("AC4: guarda marca y últimos 4 de la respuesta de MP al crear el hold", async () => {
      mp.createPayment.mockResolvedValue(payment({ payment_method_id: "master", card: { last_four_digits: "1881" } }));
      await service().create(input);
      expect(row()).toMatchObject({ cardLast4: "1881", cardBrand: "master" });
    });

    it("AC4: si MP no informa la tarjeta queda en null; no se deduce del medio pedido ni del token", async () => {
      // `input.paymentMethodId` es "visa", pero la respuesta de MP no trae ni marca ni tarjeta.
      await service().create(input);
      expect(row().cardLast4).toBeNull();
      expect(row().cardBrand).toBeNull();
    });

    it("AC4: un valor con forma inesperada se descarta en vez de persistirse", async () => {
      mp.createPayment.mockResolvedValue(
        payment({ payment_method_id: "visa; drop table", card: { last_four_digits: "12ab" } })
      );
      await service().create(input);
      expect(row().cardLast4).toBeNull();
      expect(row().cardBrand).toBeNull();
    });

    it("AC4: al reconciliar (?sync=true) se completa lo que faltaba, y una respuesta sin tarjeta no lo borra", async () => {
      await service().create(input);
      expect(row().cardLast4).toBeNull();

      mp.getPayment.mockResolvedValueOnce(payment({ payment_method_id: "visa", card: { last_four_digits: "4242" } }));
      await service().getByShipment(SHIPMENT, { sync: true });
      expect(row()).toMatchObject({ cardLast4: "4242", cardBrand: "visa" });

      mp.getPayment.mockResolvedValueOnce(payment());
      await service().getByShipment(SHIPMENT, { sync: true });
      expect(row()).toMatchObject({ cardLast4: "4242", cardBrand: "visa" });
    });

    it("AC5: el card_token no llega a la fila ni al log, y de la tarjeta solo se guardan 4 dígitos", async () => {
      mp.createPayment.mockResolvedValue(payment({ payment_method_id: "visa", card: { last_four_digits: "4242" } }));
      await service().create(input);

      expect(JSON.stringify(holds.rows[0])).not.toContain("card-token-secret");
      const logged = JSON.stringify([log.info.mock.calls, log.warn.mock.calls, log.error.mock.calls]);
      expect(logged).not.toContain("card-token-secret");
      expect(logged).not.toContain(PAYER_USER);
    });

    // Review de PR #255, punto 6: `payerId` no entra al fingerprint, así que un reintento con otro
    // emisor reusaba la fila y el pago quedaba atribuido al primero.
    describe("el pagador de un hold vigente no cambia", () => {
      const OTHER_PAYER = "99999999-9999-4999-8999-999999999999";

      it("un reintento de un hold vigente con otro payerUserId se rechaza con 409 y no llama a MP", async () => {
        await service().create(input);
        mp.createPayment.mockClear();

        await expect(service().create({ ...input, payerUserId: OTHER_PAYER })).rejects.toMatchObject({
          statusCode: 409,
          code: "HOLD_CONFLICT",
        });
        expect(mp.createPayment).not.toHaveBeenCalled();
        expect(row().payerId).toBe(PAYER_USER);
      });

      it("lo mismo con un intento sin respuesta (creating): no reusa la key a nombre de otro emisor", async () => {
        await leaveCreating();
        mp.createPayment.mockClear();

        await expect(service().create({ ...input, payerUserId: OTHER_PAYER })).rejects.toMatchObject({
          statusCode: 409,
          code: "HOLD_CONFLICT",
        });
        expect(mp.createPayment).not.toHaveBeenCalled();
      });

      it("el mismo emisor reintenta sin problema, y un hold anterior a MOVO-302 (sin payerId) no se compara", async () => {
        await service().create(input);
        expect((await service().create(input)).replayed).toBe(true);

        Object.assign(holds.rows[0], { payerId: null });
        expect((await service().create({ ...input, payerUserId: OTHER_PAYER })).replayed).toBe(true);
      });

      it("tras un rechazo el intento siguiente puede ser de otro emisor, con su propio payerId", async () => {
        mp.createPayment.mockResolvedValueOnce(
          payment({ status: "rejected", status_detail: "cc_rejected_other_reason" })
        );
        await service().create(input);

        await service().create({ ...input, payerUserId: OTHER_PAYER });

        expect(holds.rows.map((r) => (r as unknown as HistoryRow).payerId)).toEqual([PAYER_USER, OTHER_PAYER]);
      });
    });

    // Review de PR #255, punto 7: un estado que no conocemos igual trae la tarjeta en la misma respuesta.
    it("AC4: un estado de MP desconocido en el create igual deja la tarjeta (nada lo vuelve a sincronizar)", async () => {
      mp.createPayment.mockResolvedValueOnce(
        payment({ status: "in_mediation", payment_method_id: "visa", card: { last_four_digits: "4242" } })
      );

      await expect(service().create(input)).rejects.toMatchObject({ statusCode: 502 });

      expect(holds.rows[0].status).toBe("creating");
      expect(row()).toMatchObject({ cardLast4: "4242", cardBrand: "visa" });
    });

    // Review de PR #255, punto 4: `?sync=true` solo releía authorized/in_process.
    describe("?sync=true completa la tarjeta de un hold que ya salió de authorized/in_process", () => {
      const setup = async (status: "captured" | "cancelled" | "rejected", extra: Record<string, unknown> = {}) => {
        await service().create(input);
        Object.assign(holds.rows[0], { status, mpPaymentId: "5550001", ...extra });
        mp.getPayment.mockReset().mockResolvedValue(
          payment({ status: "approved", payment_method_id: "visa", card: { last_four_digits: "4242" } })
        );
      };

      it.each(["captured", "cancelled"] as const)("un hold %s sin tarjeta la recibe, sin cambiar el estado", async (status) => {
        await setup(status);

        const res = await service().getByShipment(SHIPMENT, { sync: true });

        expect(mp.getPayment).toHaveBeenCalledTimes(1);
        expect(res.status).toBe(status);
        expect(row()).toMatchObject({ cardLast4: "4242", cardBrand: "visa" });
      });

      it("con la tarjeta ya guardada no vuelve a consultar a MP", async () => {
        await setup("captured", { cardLast4: "1881", cardBrand: "master" });

        await service().getByShipment(SHIPMENT, { sync: true });

        expect(mp.getPayment).not.toHaveBeenCalled();
        expect(row()).toMatchObject({ cardLast4: "1881", cardBrand: "master" });
      });

      // Seguimiento de Pedro (review de PR #255): es un dato solo para el historial.
      it("si MP falla no tira un 502: devuelve el hold como está y lo loguea", async () => {
        await setup("captured");
        mp.getPayment.mockReset().mockRejectedValue(new Error("The operation was aborted"));

        const res = await service().getByShipment(SHIPMENT, { sync: true });

        expect(res.status).toBe("captured");
        expect(row().cardLast4).toBeNull();
        expect(log.error).toHaveBeenCalledWith(
          expect.objectContaining({ holdId: holds.rows[0].id }),
          expect.stringContaining("el hold queda como está")
        );
      });

      it("un pago sin tarjeta (marca guardada, sin últimos 4) no vuelve a consultar a MP en cada sync", async () => {
        await setup("captured", { cardBrand: "account_money" });

        await service().getByShipment(SHIPMENT, { sync: true });
        await service().getByShipment(SHIPMENT, { sync: true });

        expect(mp.getPayment).not.toHaveBeenCalled();
      });

      it("la primera consulta de un pago sin tarjeta guarda la marca y corta las siguientes", async () => {
        await setup("captured");
        mp.getPayment.mockReset().mockResolvedValue(payment({ status: "approved", payment_method_id: "account_money" }));

        await service().getByShipment(SHIPMENT, { sync: true });
        await service().getByShipment(SHIPMENT, { sync: true });

        expect(mp.getPayment).toHaveBeenCalledTimes(1);
        expect(row()).toMatchObject({ cardBrand: "account_money", cardLast4: null });
      });

      it("un hold rechazado no aparece en el historial: no se consulta", async () => {
        await setup("rejected");
        await service().getByShipment(SHIPMENT, { sync: true });
        expect(mp.getPayment).not.toHaveBeenCalled();
      });

      it("sin sync no consulta a MP aunque falte la tarjeta", async () => {
        await setup("captured");
        await service().getByShipment(SHIPMENT);
        expect(mp.getPayment).not.toHaveBeenCalled();
      });
    });

    it("AC7: HoldResponse no expone el pagador ni la tarjeta", async () => {
      mp.createPayment.mockResolvedValue(payment({ payment_method_id: "visa", card: { last_four_digits: "4242" } }));
      const { hold } = await service().create(input);

      for (const key of ["payerId", "payerUserId", "cardLast4", "cardBrand"]) {
        expect(hold).not.toHaveProperty(key);
      }
      expect(JSON.stringify(hold)).not.toContain(PAYER_USER);
      expect(JSON.stringify(hold)).not.toContain("4242");
    });
  });

  describe("getCheckoutData (AC1)", () => {
    it("devuelve la public_key del transportista, el monto y la comisión de Movo", async () => {
      const data = await service().getCheckoutData({
        shipmentId: SHIPMENT,
        carrierId: CARRIER,
        amountArs: 1150,
        payerEmail: "e@x.com",
      });
      // 1150 bruto = 1000 neto + 15% → comisión 150.
      expect(data).toEqual({
        shipmentId: SHIPMENT,
        publicKey: "TEST-public-key",
        amountArs: 1150,
        applicationFeeArs: 150,
        baseAmountArs: 1150,
        debtOffsetArs: 0,
        debtSurchargeArs: 0,
        payerEmail: "e@x.com",
      });
      expect(accounts.findActiveCredentials).toHaveBeenCalledWith(CARRIER, NOW);
    });

    it("MOVO-311: con deuda de las dos partes, la vista previa suma el recargo y sube la comisión (sin reservar)", async () => {
      holds.balances.set(CARRIER, 100).set(PAYER_USER, 200);
      const data = await service().getCheckoutData({
        shipmentId: SHIPMENT,
        carrierId: CARRIER,
        amountArs: 1150,
        payerEmail: "e@x.com",
        payerUserId: PAYER_USER,
      });
      // Recargo 200; Movo absorbe el 4,99% de MP sobre él (9,98), así que el fee lleva 190,02.
      expect(data).toMatchObject({ amountArs: 1350, applicationFeeArs: 440.02, debtOffsetArs: 100, debtSurchargeArs: 200 });
      expect(holds.rows).toHaveLength(0);
    });

    it("409 CARRIER_MP_ACCOUNT_NOT_LINKED si no hay credenciales vigentes (una sola lectura)", async () => {
      accounts.findActiveCredentials.mockResolvedValue(null);
      await expect(
        service().getCheckoutData({ shipmentId: SHIPMENT, carrierId: CARRIER, amountArs: 100, payerEmail: "e@x.com" })
      ).rejects.toMatchObject({ statusCode: 409, code: "CARRIER_MP_ACCOUNT_NOT_LINKED" });
      expect(accounts.findActiveCredentials).toHaveBeenCalledTimes(1);
    });
  });

  describe("monto (review de PR #226, punto 8)", () => {
    it.each([0, 0.004, -5, 1150.005, 10.999, Number.NaN])("%s → 400 VALIDATION_FAILED, no se redondea en silencio", async (amountArs) => {
      await expect(service().create({ ...input, amountArs })).rejects.toMatchObject({
        statusCode: 400,
        code: "VALIDATION_FAILED",
      });
      expect(mp.createPayment).not.toHaveBeenCalled();
      expect(holds.rows).toHaveLength(0);
    });

    it.each([0.01, 0.07, 1150.1, 1150.01, 99999.99])("%s es un monto válido", async (amountArs) => {
      holds = new MemoryHoldRepository();
      const { hold } = await service().create({ ...input, amountArs });
      expect(hold.amountArs).toBe(amountArs);
    });
  });

  describe("comisión real de MP en el hold (MOVO-285)", () => {
    const withFee = (original: number) =>
      payment({ charges_details: [{ name: "mercadopago_fee", accounts: { from: "collector" }, amounts: { original } }] });

    it("guarda el mercadopago_fee que informa MP al crear y lo expone vista del transportista", async () => {
      mp.createPayment.mockResolvedValueOnce(withFee(57.4));
      const { hold } = await service().create(input);
      expect(holds.rows[0].mpFeeArs?.toNumber()).toBe(57.4);
      expect(hold.carrierMpFeeArs).toBe(57.4);
    });

    it("si MP no lo informa queda null (la app sigue con el estimado)", async () => {
      const { hold } = await service().create(input);
      expect(hold.carrierMpFeeArs).toBeNull();
    });

    it("con recargo al emisor, el transportista no ve la parte del fee que cae sobre el recargo", async () => {
      holds.balances.set(PAYER_USER, 200);
      mp.createPayment.mockResolvedValueOnce(withFee(67.4));
      const { hold } = await service().create(input);
      const row = holds.rows[0];
      const surchargeFee = row.applicationFeeArs.toNumber() - row.commissionArs.toNumber() - row.debtOffsetArs.toNumber();
      expect(hold.debtSurchargeArs).toBe(200);
      expect(hold.carrierMpFeeArs).toBeCloseTo(67.4 - (200 - surchargeFee), 2);
    });
  });

  describe("create", () => {
    it("crea el pago con capture:false, application_fee y el token del transportista (AC2)", async () => {
      const { hold, replayed } = await service().create(input);

      expect(replayed).toBe(false);
      expect(mp.createPayment).toHaveBeenCalledTimes(1);
      const [token, body, key] = mp.createPayment.mock.calls[0];
      expect(token).toBe("TEST-access");
      expect(body).toMatchObject({
        transaction_amount: 1150,
        capture: false,
        installments: 1,
        token: "card-token-secret",
        payment_method_id: "visa",
        application_fee: 150,
        payer: { email: PAYER_EMAIL },
        external_reference: SHIPMENT,
      });
      expect(key).toBe(`movo-hold-${SHIPMENT}-1`);
      expect(hold).toMatchObject({
        shipmentId: SHIPMENT,
        carrierId: CARRIER,
        collectorId: MP_USER,
        attempt: 1,
        mpPaymentId: "5550001",
        amountArs: 1150,
        applicationFeeArs: 150,
        status: "authorized",
        statusDetail: "pending_capture",
        failureReason: null,
      });
    });

    it("guarda una huella del pedido, nunca el card_token en claro", async () => {
      await service().create(input);
      const fingerprint = holds.rows[0].requestFingerprint as string;
      expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(fingerprint).not.toContain("card-token-secret");
    });

    it("expires_at sale de la configuración, no de una constante (AC4)", async () => {
      const five = await service(5).create(input);
      expect(five.hold.expiresAt).toBe(new Date(NOW.getTime() + 5 * 86_400_000).toISOString());

      holds = new MemoryHoldRepository();
      const seven = await service(7).create(input);
      expect(seven.hold.expiresAt).toBe(new Date(NOW.getTime() + 7 * 86_400_000).toISOString());
    });

    it("un rechazo por fondos insuficientes vuelve como hold rejected con su motivo (AC5)", async () => {
      mp.createPayment.mockResolvedValue(payment({ status: "rejected", status_detail: "cc_rejected_insufficient_amount" }));
      const { hold } = await service().create(input);
      expect(hold).toMatchObject({
        status: "rejected",
        statusDetail: "cc_rejected_insufficient_amount",
        failureReason: "insufficient_funds",
        expiresAt: null,
      });
    });

    it("un 400 de MP por card_token inválido queda invalid_data; por cuentas, platform_error", async () => {
      mp.createPayment.mockRejectedValueOnce({ status: 400, message: "Card token not found", cause: [{ code: 2006 }] });
      const tokenError = await service().create(input);
      expect(tokenError.hold).toMatchObject({ status: "rejected", failureReason: "invalid_data", statusDetail: "mp_error_2006" });

      mp.createPayment.mockRejectedValueOnce({ status: 400, message: "Invalid users involved", cause: [{ code: 2034 }] });
      const usersError = await service().create(input);
      expect(usersError.hold).toMatchObject({ status: "rejected", failureReason: "platform_error", statusDetail: "mp_error_2034" });
    });

    it("sin la cuenta de MP del transportista vigente no llama a MP ni abre un intento", async () => {
      accounts.findActiveCredentials.mockResolvedValue(null);
      await expect(service().create(input)).rejects.toMatchObject({ code: "CARRIER_MP_ACCOUNT_NOT_LINKED" });
      expect(mp.createPayment).not.toHaveBeenCalled();
      expect(holds.rows).toHaveLength(0);
    });

    describe("errores de MP al crear (punto 2)", () => {
      it.each([408, 409, 429, 503])("un %s deja el intento en creating y responde 502, sin cerrarlo", async (status) => {
        mp.createPayment.mockRejectedValueOnce({ status, message: "x" });
        await expect(service().create(input)).rejects.toMatchObject({ statusCode: 502, code: "PAYMENT_PROVIDER_ERROR" });
        expect(holds.rows).toHaveLength(1);
        expect(holds.rows[0].status).toBe("creating");
      });

      it("un 4xx con una causa que no conocemos tampoco cierra el intento", async () => {
        mp.createPayment.mockRejectedValueOnce({ status: 400, message: "x", cause: [{ code: 9999 }] });
        await expect(service().create(input)).rejects.toMatchObject({ statusCode: 502 });
        expect(holds.rows[0].status).toBe("creating");
      });

      it("un 401/403 es del token del transportista: 409 y el intento sigue reintentable con la misma key", async () => {
        mp.createPayment.mockRejectedValueOnce({ status: 401, message: "unauthorized" });
        await expect(service().create(input)).rejects.toMatchObject({
          statusCode: 409,
          code: "CARRIER_MP_ACCOUNT_NOT_LINKED",
        });
        expect(holds.rows[0].status).toBe("creating");

        const retry = await service().create(input);
        expect(retry.hold.status).toBe("authorized");
        const keys = mp.createPayment.mock.calls.map((c) => c[2]);
        expect(keys).toEqual([`movo-hold-${SHIPMENT}-1`, `movo-hold-${SHIPMENT}-1`]);
      });
    });

    describe("estado de pago desconocido (punto 1)", () => {
      it("al crear, un estado inesperado deja el intento en creating y no abre otro", async () => {
        mp.createPayment.mockResolvedValueOnce(payment({ status: "charged_back", status_detail: "x" }));
        const svc = service();
        await expect(svc.create(input)).rejects.toMatchObject({ statusCode: 502, code: "PAYMENT_PROVIDER_ERROR" });
        expect(holds.rows[0]).toMatchObject({ status: "creating", mpPaymentId: "5550001" });

        // El reintento reusa el intento 1 (misma key), no abre el 2.
        await svc.create(input);
        expect(holds.rows).toHaveLength(1);
        expect(mp.createPayment.mock.calls.map((c) => c[2])).toEqual([
          `movo-hold-${SHIPMENT}-1`,
          `movo-hold-${SHIPMENT}-1`,
        ]);
      });

      it("en un sync, un estado desconocido deja el hold authorized sin cambios", async () => {
        const svc = service();
        await svc.create(input);
        mp.getPayment.mockResolvedValue(payment({ status: "in_mediation" }));
        const synced = await svc.getByShipment(SHIPMENT, { sync: true });
        expect(synced.status).toBe("authorized");
        expect(holds.rows[0].status).toBe("authorized");
        expect(log.error).toHaveBeenCalled();
      });

      it("liberar con una respuesta de MP que no es cancelled es un 502, no un 200", async () => {
        const svc = service();
        await svc.create(input);
        mp.cancelPayment.mockResolvedValue(payment({ status: "refunded" }));
        await expect(svc.release(SHIPMENT)).rejects.toMatchObject({ statusCode: 502, code: "PAYMENT_PROVIDER_ERROR" });
        expect(holds.rows[0].status).toBe("authorized");
      });
    });

    describe("idempotencia (AC6)", () => {
      it("un reintento con un hold ya autorizado no crea un segundo pago", async () => {
        const svc = service();
        const first = await svc.create(input);
        const second = await svc.create(input);

        expect(mp.createPayment).toHaveBeenCalledTimes(1);
        expect(second.replayed).toBe(true);
        expect(second.hold.id).toBe(first.hold.id);
        expect(holds.rows).toHaveLength(1);
      });

      it("el reintento de un hold vigente funciona aunque el transportista ya se haya desvinculado (punto 3)", async () => {
        const svc = service();
        const first = await svc.create(input);
        accounts.findActiveCredentials.mockResolvedValue(null);

        const retry = await svc.create(input);
        expect(retry.replayed).toBe(true);
        expect(retry.hold.id).toBe(first.hold.id);
      });

      it("si MP no respondió, el intento queda creating y el reintento con el mismo cuerpo reusa la MISMA key", async () => {
        const svc = service();
        await leaveCreating(svc);

        const retry = await svc.create(input);
        expect(retry.hold.status).toBe("authorized");
        expect(holds.rows).toHaveLength(1);
        expect(mp.searchPaymentsByExternalReference).not.toHaveBeenCalled();
        const keys = mp.createPayment.mock.calls.map((c) => c[2]);
        expect(keys).toEqual([`movo-hold-${SHIPMENT}-1`, `movo-hold-${SHIPMENT}-1`]);
      });

      it("tras un rechazo, el intento siguiente usa otra key (otra tarjeta)", async () => {
        const svc = service();
        mp.createPayment.mockResolvedValueOnce(payment({ status: "rejected", status_detail: "cc_rejected_other_reason" }));
        const rejected = await svc.create(input);
        expect(rejected.hold.status).toBe("rejected");

        const second = await svc.create({ ...input, cardToken: "otra-tarjeta" });
        expect(second.hold).toMatchObject({ attempt: 2, status: "authorized" });
        const keys = mp.createPayment.mock.calls.map((c) => c[2]);
        expect(keys).toEqual([`movo-hold-${SHIPMENT}-1`, `movo-hold-${SHIPMENT}-2`]);
      });

      it("un hold vivo con otro transportista o monto es HOLD_CONFLICT, no se pisa", async () => {
        const svc = service();
        await svc.create(input);
        await expect(svc.create({ ...input, amountArs: 2000 })).rejects.toMatchObject({
          statusCode: 409,
          code: "HOLD_CONFLICT",
        });
        await expect(svc.create({ ...input, carrierId: OTHER_CARRIER })).rejects.toBeInstanceOf(ApiError);
        expect(mp.createPayment).toHaveBeenCalledTimes(1);
      });

      it("pierde una carrera por el intento y converge en el hold que dejó el ganador", async () => {
        const svc = service();
        // Simula que otro request insertó el intento justo entre la lectura y el insert.
        const original = holds.createAttempt.bind(holds);
        let first = true;
        holds.createAttempt = async (data) => {
          if (first) {
            first = false;
            await original(data);
            throw new HoldAttemptConflictError();
          }
          return original(data);
        };
        const result = await svc.create(input);
        expect(holds.rows).toHaveLength(1);
        expect(result.hold.attempt).toBe(1);
        expect(mp.createPayment).toHaveBeenCalledTimes(1);
      });
    });

    describe("reintento de un creating con otro cuerpo (puntos 5 y 6)", () => {
      it("con otra tarjeta, si MP ya tiene el pago lo adopta y no crea otro", async () => {
        const svc = service();
        await leaveCreating(svc);
        mp.searchPaymentsByExternalReference.mockResolvedValue([
          { id: "777", status: "authorized", status_detail: "pending_capture" },
        ]);

        const retry = await svc.create({ ...input, cardToken: "otra-tarjeta" });
        expect(retry.replayed).toBe(true);
        expect(retry.hold).toMatchObject({ attempt: 1, status: "authorized", mpPaymentId: "777" });
        expect(mp.createPayment).toHaveBeenCalledTimes(1);
        expect(mp.searchPaymentsByExternalReference).toHaveBeenCalledWith("TEST-access", SHIPMENT);
      });

      it("con otra tarjeta, si MP no tiene el pago cierra el intento viejo y abre otro con otra key", async () => {
        const svc = service();
        await leaveCreating(svc);
        mp.searchPaymentsByExternalReference.mockResolvedValue([]);

        const retry = await svc.create({ ...input, cardToken: "otra-tarjeta" });
        expect(retry.hold).toMatchObject({ attempt: 2, status: "authorized" });
        expect(holds.rows[0]).toMatchObject({ status: "rejected", statusDetail: "superseded" });
        expect(mp.createPayment.mock.calls.map((c) => c[2])).toEqual([
          `movo-hold-${SHIPMENT}-1`,
          `movo-hold-${SHIPMENT}-2`,
        ]);
      });

      it("un pago viejo ya cancelado en MP no cuenta como vivo", async () => {
        const svc = service();
        await leaveCreating(svc);
        mp.searchPaymentsByExternalReference.mockResolvedValue([{ id: "1", status: "cancelled" }]);
        const retry = await svc.create({ ...input, cardToken: "otra-tarjeta" });
        expect(retry.hold.attempt).toBe(2);
      });

      it("con otro monto, si MP ya tiene el pago es HOLD_CONFLICT en vez de pisarlo", async () => {
        const svc = service();
        await leaveCreating(svc);
        mp.searchPaymentsByExternalReference.mockResolvedValue([{ id: "777", status: "authorized" }]);

        await expect(svc.create({ ...input, amountArs: 1300 })).rejects.toMatchObject({ code: "HOLD_CONFLICT" });
        expect(mp.createPayment).toHaveBeenCalledTimes(1);
      });

      it("con otro monto y MP sin el pago, se cierra y se abre uno nuevo", async () => {
        const svc = service();
        await leaveCreating(svc);
        const next = await svc.create({ ...input, amountArs: 1300 });
        expect(next.hold).toMatchObject({ attempt: 2, amountArs: 1300, status: "authorized" });
        expect(holds.rows[0]).toMatchObject({ status: "rejected", statusDetail: "superseded" });
      });

      it("si falla la búsqueda en MP no abre otro intento: 502", async () => {
        const svc = service();
        await leaveCreating(svc);
        mp.searchPaymentsByExternalReference.mockRejectedValue(new Error("down"));
        await expect(svc.create({ ...input, cardToken: "otra" })).rejects.toMatchObject({ statusCode: 502 });
        expect(holds.rows).toHaveLength(1);
        expect(holds.rows[0].status).toBe("creating");
      });
    });

    it("no loguea el card_token ni el email del pagador (AC9)", async () => {
      mp.createPayment.mockRejectedValueOnce({ status: 400, message: "x", cause: [{ code: 2006 }] });
      const svc = service();
      await svc.create(input);
      await svc.create({ ...input, cardToken: "card-token-secret-2" });

      const logged = JSON.stringify([...log.info.mock.calls, ...log.warn.mock.calls, ...log.error.mock.calls]);
      expect(logged).not.toContain("card-token-secret");
      expect(logged).not.toContain(PAYER_EMAIL);
      expect(logged).not.toContain("TEST-access");
    });
  });

  describe("getByShipment (AC7)", () => {
    it("404 HOLD_NOT_FOUND sin ningún intento", async () => {
      await expect(service().getByShipment(SHIPMENT)).rejects.toMatchObject({ statusCode: 404, code: "HOLD_NOT_FOUND" });
    });

    it("devuelve lo persistido sin tocar MP, y con sync lo actualiza desde MP", async () => {
      const svc = service();
      await svc.create(input);

      const stored = await svc.getByShipment(SHIPMENT);
      expect(stored.status).toBe("authorized");
      expect(mp.getPayment).not.toHaveBeenCalled();

      mp.getPayment.mockResolvedValue(payment({ status: "cancelled", status_detail: "expired" }));
      const synced = await svc.getByShipment(SHIPMENT, { sync: true });
      expect(mp.getPayment).toHaveBeenCalledWith("TEST-access", "5550001");
      expect(synced).toMatchObject({ status: "cancelled", statusDetail: "expired" });
    });

    it("con sync, un creating cuyo pago ya existe en MP se adopta", async () => {
      const svc = service();
      await leaveCreating(svc);
      mp.searchPaymentsByExternalReference.mockResolvedValue([{ id: "777", status: "authorized", status_detail: "pending_capture" }]);
      const synced = await svc.getByShipment(SHIPMENT, { sync: true });
      expect(synced).toMatchObject({ status: "authorized", mpPaymentId: "777" });
    });
  });

  describe("release (AC8)", () => {
    it("cancela en MP con el token del transportista y deja el hold cancelled", async () => {
      const svc = service();
      const { hold } = await svc.create(input);
      const released = await svc.release(SHIPMENT);

      expect(mp.cancelPayment).toHaveBeenCalledWith("TEST-access", "5550001", `movo-hold-release-${hold.id}`);
      expect(released.status).toBe("cancelled");
    });

    it("es idempotente: liberar dos veces cancela una sola vez", async () => {
      const svc = service();
      await svc.create(input);
      await svc.release(SHIPMENT);
      const again = await svc.release(SHIPMENT);
      expect(again.status).toBe("cancelled");
      expect(mp.cancelPayment).toHaveBeenCalledTimes(1);
    });

    it("tras liberar, el emisor puede crear un hold nuevo (intento 2)", async () => {
      const svc = service();
      await svc.create(input);
      await svc.release(SHIPMENT);
      const next = await svc.create(input);
      expect(next.hold).toMatchObject({ attempt: 2, status: "authorized" });
    });

    it("una liberación demorada no cancela un intento posterior del mismo transportista", async () => {
      const svc = service();
      const first = (await svc.create(input)).hold;
      await svc.release(SHIPMENT, CARRIER, first.id);
      const second = (await svc.create(input)).hold;
      await expect(svc.release(SHIPMENT, CARRIER, first.id))
        .rejects.toMatchObject({ statusCode: 409, code: "HOLD_CONFLICT" });
      expect(second.id).not.toBe(first.id);
      expect(mp.cancelPayment).toHaveBeenCalledTimes(1);
    });

    it("un intento rechazado no retuvo fondos: se devuelve tal cual, sin llamar a MP", async () => {
      mp.createPayment.mockResolvedValue(payment({ status: "rejected", status_detail: "cc_rejected_other_reason" }));
      const svc = service();
      await svc.create(input);
      const released = await svc.release(SHIPMENT);
      expect(released.status).toBe("rejected");
      expect(mp.cancelPayment).not.toHaveBeenCalled();
    });

    it("409 HOLD_NOT_RELEASABLE si ya se capturó", async () => {
      const svc = service();
      await svc.create(input);
      holds.rows[0].status = "captured";
      await expect(svc.release(SHIPMENT)).rejects.toMatchObject({ statusCode: 409, code: "HOLD_NOT_RELEASABLE" });
    });

    describe("intento en creating (punto 5)", () => {
      it("si MP ya tiene el pago, lo adopta y lo cancela", async () => {
        const svc = service();
        await leaveCreating(svc);
        mp.searchPaymentsByExternalReference.mockResolvedValue([{ id: "777", status: "authorized" }]);
        mp.cancelPayment.mockResolvedValue(payment({ id: 777, status: "cancelled", status_detail: "by_collector" }));

        const released = await svc.release(SHIPMENT);
        expect(mp.cancelPayment).toHaveBeenCalledWith("TEST-access", "777", expect.any(String));
        expect(released).toMatchObject({ status: "cancelled", mpPaymentId: "777" });
      });

      it("si MP no lo tiene y el intento es reciente, responde 409 sin cerrarlo", async () => {
        const svc = service();
        await leaveCreating(svc);
        await expect(svc.release(SHIPMENT)).rejects.toMatchObject({ statusCode: 409, code: "HOLD_NOT_RELEASABLE" });
        expect(holds.rows[0].status).toBe("creating");
      });

      it("si MP no lo tiene y el intento es viejo, lo da por abandonado", async () => {
        const svc = service();
        await leaveCreating(svc);
        clock = new Date(NOW.getTime() + STALE_CREATING_MS + 1000);

        const released = await svc.release(SHIPMENT);
        expect(released).toMatchObject({ status: "rejected", statusDetail: "abandoned" });
        expect(mp.cancelPayment).not.toHaveBeenCalled();
      });
    });

    describe("credenciales del transportista (punto 4)", () => {
      it("sin credenciales no se puede liberar: 409 y queda logueado para operación", async () => {
        const svc = service();
        await svc.create(input);
        accounts.findCredentials.mockResolvedValue(null);

        await expect(svc.release(SHIPMENT)).rejects.toMatchObject({ statusCode: 409, code: "CARRIER_MP_ACCOUNT_NOT_LINKED" });
        expect(holds.rows[0].status).toBe("authorized");
        expect(log.error).toHaveBeenCalledWith(
          expect.objectContaining({ holdId: holds.rows[0].id, mpPaymentId: "5550001" }),
          expect.stringContaining("hold sin liberar")
        );
      });

      it("un 401/403 de MP al cancelar se informa como cuenta no vinculada, no como 502", async () => {
        const svc = service();
        await svc.create(input);
        mp.cancelPayment.mockRejectedValue({ status: 401, message: "unauthorized" });
        await expect(svc.release(SHIPMENT)).rejects.toMatchObject({ statusCode: 409, code: "CARRIER_MP_ACCOUNT_NOT_LINKED" });
      });
    });

    it("si la cancelación falla pero MP ya lo tenía cancelado, lo da por liberado", async () => {
      const svc = service();
      await svc.create(input);
      mp.cancelPayment.mockRejectedValue({ status: 400, message: "already cancelled" });
      mp.getPayment.mockResolvedValue(payment({ status: "cancelled", status_detail: "expired" }));
      const released = await svc.release(SHIPMENT);
      expect(released.status).toBe("cancelled");
    });

    it("502 si MP falla y el pago sigue vigente", async () => {
      const svc = service();
      await svc.create(input);
      mp.cancelPayment.mockRejectedValue({ status: 503, message: "down" });
      await expect(svc.release(SHIPMENT)).rejects.toMatchObject({ statusCode: 502, code: "PAYMENT_PROVIDER_ERROR" });
      expect(holds.rows[0].status).toBe("authorized");
    });
  });
});
