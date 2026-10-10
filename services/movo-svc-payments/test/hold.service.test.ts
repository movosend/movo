import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FastifyBaseLogger } from "fastify";
import { ApiError } from "@movo/shared";
import { createHoldService, failureReasonFromStatusDetail } from "../src/modules/holds/hold.service";
import type { MercadoPagoClient, PaymentResponse } from "../src/adapters/mercadopago-client";
import type { CarrierMpAccountRepository } from "../src/repositories/carrier-mp-account-repository";
import {
  Hold,
  HoldAttemptConflictError,
  HoldRepository,
  HoldUpdate,
  NewHoldAttempt,
} from "../src/repositories/hold-repository";

const SHIPMENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CARRIER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER_CARRIER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
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
    const live = ["creating", "in_process", "authorized", "captured"];
    const clash = this.rows.some(
      (r) =>
        r.shipmentId === data.shipmentId && (r.attempt === data.attempt || live.includes(r.status))
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

function linkedAccount(overrides: Record<string, unknown> = {}) {
  return {
    userId: CARRIER,
    mpUserId: "2991764998",
    email: "v@testuser.com",
    nickname: "TESTUSER",
    accessToken: "enc",
    refreshToken: "enc",
    publicKey: "TEST-public-key",
    scope: "offline_access",
    tokenExpiresAt: new Date(NOW.getTime() + 86_400_000),
    connectedAt: NOW,
    revokedAt: null,
    unlinkedAt: null,
    ...overrides,
  };
}

function payment(overrides: Partial<PaymentResponse> = {}): PaymentResponse {
  return { id: 1352823085, status: "authorized", status_detail: "pending_capture", ...overrides } as PaymentResponse;
}

const silentLog = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as FastifyBaseLogger;

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

describe("HoldService (MOVO-209)", () => {
  let holds: MemoryHoldRepository;
  let mp: { [K in keyof MercadoPagoClient]: ReturnType<typeof vi.fn> };
  let accounts: { findByUserId: ReturnType<typeof vi.fn>; findCredentials: ReturnType<typeof vi.fn> };

  function service(holdValidityDays = 5) {
    return createHoldService({
      holdValidityDays,
      holds,
      accounts: accounts as unknown as CarrierMpAccountRepository,
      mercadoPago: mp as unknown as MercadoPagoClient,
      log: silentLog,
      now: () => NOW,
    });
  }

  const input = {
    shipmentId: SHIPMENT,
    carrierId: CARRIER,
    cardToken: "card-token-secret",
    amountArs: 1150,
    payerEmail: "test_user_4715592661702347785@testuser.com",
    paymentMethodId: "visa",
  };

  beforeEach(() => {
    holds = new MemoryHoldRepository();
    mp = {
      createPayment: vi.fn(async () => payment()),
      getPayment: vi.fn(async () => payment()),
      capturePayment: vi.fn(),
      cancelPayment: vi.fn(async () => payment({ status: "cancelled", status_detail: "by_collector" })),
    };
    accounts = {
      findByUserId: vi.fn(async () => linkedAccount()),
      findCredentials: vi.fn(async () => ({
        mpUserId: "2991764998",
        accessToken: "TEST-access",
        refreshToken: "TG-refresh",
        publicKey: "TEST-public-key",
      })),
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
    });

    it.each([
      ["sin cuenta", null],
      ["desvinculada", linkedAccount({ unlinkedAt: NOW })],
      ["revocada", linkedAccount({ revokedAt: NOW })],
      ["con el token vencido", linkedAccount({ tokenExpiresAt: new Date(NOW.getTime() - 1) })],
    ])("409 CARRIER_MP_ACCOUNT_NOT_LINKED si el transportista está %s", async (_label, account) => {
      accounts.findByUserId.mockResolvedValue(account);
      await expect(
        service().getCheckoutData({ shipmentId: SHIPMENT, carrierId: CARRIER, amountArs: 100, payerEmail: "e@x.com" })
      ).rejects.toMatchObject({ statusCode: 409, code: "CARRIER_MP_ACCOUNT_NOT_LINKED" });
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
        payer: { email: input.payerEmail },
        external_reference: SHIPMENT,
      });
      expect(key).toBe(`movo-hold-${SHIPMENT}-1`);
      expect(hold).toMatchObject({
        shipmentId: SHIPMENT,
        carrierId: CARRIER,
        collectorId: "2991764998",
        attempt: 1,
        mpPaymentId: "1352823085",
        amountArs: 1150,
        applicationFeeArs: 150,
        status: "authorized",
        statusDetail: "pending_capture",
        failureReason: null,
      });
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

    it("un 400 de MP por card_token inválido queda como invalid_data; otro 4xx, como platform_error", async () => {
      mp.createPayment.mockRejectedValueOnce({ status: 400, message: "Card token not found", cause: [{ code: 2006 }] });
      const tokenError = await service().create(input);
      expect(tokenError.hold).toMatchObject({ status: "rejected", failureReason: "invalid_data", statusDetail: "mp_error_2006" });

      mp.createPayment.mockRejectedValueOnce({ status: 400, message: "Invalid users involved", cause: [{ code: 2034 }] });
      const usersError = await service().create(input);
      expect(usersError.hold).toMatchObject({ status: "rejected", failureReason: "platform_error", statusDetail: "mp_error_2034" });
    });

    it("sin la cuenta de MP del transportista vigente no llama a MP", async () => {
      accounts.findByUserId.mockResolvedValue(null);
      await expect(service().create(input)).rejects.toMatchObject({ code: "CARRIER_MP_ACCOUNT_NOT_LINKED" });
      expect(mp.createPayment).not.toHaveBeenCalled();
      expect(holds.rows).toHaveLength(0);
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

      it("si MP no respondió (5xx/timeout) el intento queda creating y el reintento reusa la MISMA key", async () => {
        const svc = service();
        mp.createPayment.mockRejectedValueOnce(new Error("The operation was aborted"));
        await expect(svc.create(input)).rejects.toMatchObject({ statusCode: 502, code: "PAYMENT_PROVIDER_ERROR" });
        expect(holds.rows).toHaveLength(1);
        expect(holds.rows[0].status).toBe("creating");

        const retry = await svc.create(input);
        expect(retry.hold.status).toBe("authorized");
        expect(holds.rows).toHaveLength(1);
        const keys = mp.createPayment.mock.calls.map((c) => c[2]);
        expect(keys).toEqual([`movo-hold-${SHIPMENT}-1`, `movo-hold-${SHIPMENT}-1`]);
      });

      it("un 5xx de MP también deja el intento reintentable", async () => {
        mp.createPayment.mockRejectedValueOnce({ status: 503, message: "unavailable" });
        await expect(service().create(input)).rejects.toMatchObject({ code: "PAYMENT_PROVIDER_ERROR" });
        expect(holds.rows[0].status).toBe("creating");
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
        accounts.findByUserId.mockResolvedValue(linkedAccount({ userId: OTHER_CARRIER }));
        await expect(svc.create({ ...input, carrierId: OTHER_CARRIER })).rejects.toBeInstanceOf(ApiError);
        expect(mp.createPayment).toHaveBeenCalledTimes(1);
      });

      it("un intento creating con otro monto se cierra y se abre uno nuevo con otra key", async () => {
        const svc = service();
        mp.createPayment.mockRejectedValueOnce(new Error("timeout"));
        await expect(svc.create(input)).rejects.toBeInstanceOf(ApiError);

        const next = await svc.create({ ...input, amountArs: 1300 });
        expect(next.hold).toMatchObject({ attempt: 2, amountArs: 1300, status: "authorized" });
        expect(holds.rows[0]).toMatchObject({ status: "rejected", statusDetail: "superseded" });
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

    it("no loguea el card_token ni el email del pagador (AC9)", async () => {
      const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
      const svc = createHoldService({
        holdValidityDays: 5,
        holds,
        accounts: accounts as unknown as CarrierMpAccountRepository,
        mercadoPago: mp as unknown as MercadoPagoClient,
        log: log as unknown as FastifyBaseLogger,
        now: () => NOW,
      });
      mp.createPayment.mockRejectedValueOnce({ status: 400, message: "x", cause: [{ code: 2006 }] });
      await svc.create(input);
      await svc.create({ ...input, cardToken: "card-token-secret-2" });

      const logged = JSON.stringify([...log.info.mock.calls, ...log.warn.mock.calls, ...log.error.mock.calls]);
      expect(logged).not.toContain("card-token-secret");
      expect(logged).not.toContain(input.payerEmail);
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
      expect(mp.getPayment).toHaveBeenCalledWith("TEST-access", "1352823085");
      expect(synced).toMatchObject({ status: "cancelled", statusDetail: "expired" });
    });
  });

  describe("release (AC8)", () => {
    it("cancela en MP con el token del transportista y deja el hold cancelled", async () => {
      const svc = service();
      const { hold } = await svc.create(input);
      const released = await svc.release(SHIPMENT);

      expect(mp.cancelPayment).toHaveBeenCalledWith("TEST-access", "1352823085", `movo-hold-release-${hold.id}`);
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

    it("409 HOLD_NOT_RELEASABLE si ya se capturó o si todavía está creating", async () => {
      const svc = service();
      await svc.create(input);
      holds.rows[0].status = "captured";
      await expect(svc.release(SHIPMENT)).rejects.toMatchObject({ statusCode: 409, code: "HOLD_NOT_RELEASABLE" });

      holds.rows[0].status = "creating";
      holds.rows[0].mpPaymentId = null;
      await expect(svc.release(SHIPMENT)).rejects.toMatchObject({ code: "HOLD_NOT_RELEASABLE" });
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
