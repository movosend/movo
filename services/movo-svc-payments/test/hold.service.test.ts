import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FastifyBaseLogger } from "fastify";
import { ApiError, CLOSED_HOLD_STATUSES, LIVE_HOLD_STATUSES } from "@movo/shared";
import {
  classifyCreateError,
  createHoldService,
  failureReasonFromStatusDetail,
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
const PAYER_EMAIL = "comprador@example.com";
const NOW = new Date("2026-10-10T12:00:00.000Z");

/** Repo en memoria con la misma semántica de unicidad que la base real. */
class MemoryHoldRepository implements HoldRepository {
  rows: Hold[] = [];
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
    const row = {
      id: `00000000-0000-4000-8000-${String(++this.seq).padStart(12, "0")}`,
      shipmentId: data.shipmentId,
      attempt: data.attempt,
      carrierId: data.carrierId,
      collectorId: data.collectorId,
      mpPaymentId: null,
      amountArs: { toNumber: () => data.amountArs },
      applicationFeeArs: { toNumber: () => data.applicationFeeArs },
      status: "creating",
      statusDetail: null,
      failureReason: null,
      requestFingerprint: data.requestFingerprint,
      expiresAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    } as unknown as Hold;
    this.rows.push(row);
    return row;
  }

  async update(id: string, patch: HoldUpdate) {
    const row = this.rows.find((r) => r.id === id) as Hold;
    Object.assign(row, patch);
    return row;
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

describe("classifyCreateError (review de PR #226, punto 2)", () => {
  const info = (status: number | undefined, causeCodes: string[] = []) => ({ status, causeCodes, message: "x" });

  it("solo un 400/422 con causa conocida cierra el intento", () => {
    expect(classifyCreateError(info(400, ["2006"]))).toEqual({ kind: "rejected", failureReason: "invalid_data" });
    expect(classifyCreateError(info(422, ["3003"]))).toEqual({ kind: "rejected", failureReason: "invalid_data" });
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
  let log: ReturnType<typeof silentLog>;
  let clock: Date;

  function service(holdValidityDays = 5) {
    return createHoldService({
      holdValidityDays,
      holds,
      accounts: accounts as unknown as CarrierMpAccountRepository,
      mercadoPago: mp as unknown as MercadoPagoClient,
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
        payerEmail: "e@x.com",
      });
      expect(accounts.findActiveCredentials).toHaveBeenCalledWith(CARRIER, NOW);
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
