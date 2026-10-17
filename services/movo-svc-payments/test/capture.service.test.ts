import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FastifyBaseLogger } from "fastify";
import { ApiError } from "@movo/shared";
import { Prisma } from "../src/generated/prisma/client";
import { createCaptureService, readFeeBreakdown, splitRetainedFee } from "../src/modules/settlements/capture.service";
import type { MercadoPagoClient, PaymentResponse } from "../src/adapters/mercadopago-client";
import type { CarrierMpAccountRepository } from "../src/repositories/carrier-mp-account-repository";
import type { Hold, HoldRepository, HoldUpdate } from "../src/repositories/hold-repository";
import type {
  NewSettlement,
  Settlement,
  SettlementRepository,
  SettlementUpdate,
} from "../src/repositories/settlement-repository";

// Todos los ids son ficticios: nada de cuentas reales de sandbox en fixtures versionados.
const SHIPMENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CARRIER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const HOLD_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const MP_PAYMENT = "1352823085";
const NOW = new Date("2026-10-12T12:00:00.000Z");

const D = (v: number | string) => new Prisma.Decimal(v);

function makeHold(overrides: Partial<Hold> = {}): Hold {
  return {
    id: HOLD_ID,
    shipmentId: SHIPMENT,
    attempt: 1,
    carrierId: CARRIER,
    collectorId: "1000000001",
    mpPaymentId: MP_PAYMENT,
    amountArs: D(1000),
    applicationFeeArs: D(150),
    baseAmountArs: D(1000),
    commissionArs: D(150),
    debtOffsetArs: D(0),
    debtSurchargeArs: D(0),
    status: "authorized",
    statusDetail: "pending_capture",
    failureReason: null,
    requestFingerprint: null,
    expiresAt: new Date("2026-10-15T12:00:00.000Z"),
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as Hold;
}

class MemoryHoldRepository implements HoldRepository {
  constructor(public hold: Hold | null) {}
  async findLatestByShipment() {
    return this.hold;
  }
  async createAttempt(): Promise<Hold> {
    throw new Error("no se usa en captura");
  }
  async update(_id: string, patch: HoldUpdate) {
    Object.assign(this.hold as Hold, patch);
    return this.hold as Hold;
  }
  async markCaptured(_id: string, patch: { statusDetail: string | null }) {
    if (this.hold?.status !== "authorized") return false;
    Object.assign(this.hold, { status: "captured", statusDetail: patch.statusDetail, expiresAt: null });
    return true;
  }
}

/** Misma garantía que la base real: una sola fila por envío. */
class MemorySettlementRepository implements SettlementRepository {
  row: Settlement | null = null;
  creates = 0;
  async findByShipment() {
    return this.row;
  }
  async findOrCreateProcessing(data: NewSettlement) {
    if (!this.row) {
      this.creates += 1;
      this.row = {
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        ...data,
        mpFeeArs: null,
        netAmountArs: null,
        debtOffsetArs: D(0),
        debtSurchargeArs: D(0),
        debtSurchargeFeeArs: D(0),
        carrierGrossAmountArs: null,
        carrierMpFeeArs: null,
        status: "processing",
        failureReason: null,
        statusDetail: null,
        capturedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      } as Settlement;
    }
    return this.row;
  }
  async update(_id: string, patch: SettlementUpdate) {
    Object.assign(this.row as Settlement, patch, { updatedAt: this.clock() });
    return this.row as Settlement;
  }
  async updateIfStatus(_id: string, expected: Settlement["status"], patch: SettlementUpdate) {
    if (this.row?.status !== expected) return false;
    Object.assign(this.row, patch, { updatedAt: this.clock() });
    return true;
  }
  /** Reloj de `updatedAt`: los tests de re-vinculación lo mueven para ordenar "falló" y "se re-vinculó". */
  clock: () => Date = () => NOW;
}

function payment(overrides: Record<string, unknown> = {}): PaymentResponse {
  return {
    id: Number(MP_PAYMENT),
    status: "approved",
    status_detail: "accredited",
    transaction_amount: 1000,
    fee_details: [
      { type: "mercadopago_fee", amount: 41, fee_payer: "collector" },
      { type: "application_fee", amount: 150, fee_payer: "collector" },
    ],
    transaction_details: { net_received_amount: 809 },
    ...overrides,
  } as unknown as PaymentResponse;
}

const silentLog = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as FastifyBaseLogger;

function setup(
  opts: {
    hold?: Hold | null;
    credentials?: boolean;
    /** Pisa campos de las credenciales (vencimiento del token, última actualización de la vinculación). */
    account?: { tokenExpiresAt?: Date | null; updatedAt?: Date };
  } = {}
) {
  const holds = new MemoryHoldRepository(opts.hold === undefined ? makeHold() : opts.hold);
  const settlements = new MemorySettlementRepository();
  const mp = {
    capturePayment: vi.fn(async () => payment()),
    getPayment: vi.fn(async () => payment()),
    createPayment: vi.fn(),
    cancelPayment: vi.fn(),
    searchPaymentsByExternalReference: vi.fn(),
  };
  const accounts = {
    findCredentials: vi.fn(async () =>
      opts.credentials === false
        ? null
        : {
            mpUserId: "1000000001",
            accessToken: "TEST-access",
            refreshToken: "TG-r",
            publicKey: "TEST-pk",
            tokenExpiresAt: null,
            updatedAt: new Date("2026-10-01T00:00:00.000Z"),
            ...opts.account,
          }
    ),
  } as unknown as CarrierMpAccountRepository;
  const ledger = { settleHoldDebt: vi.fn(async () => undefined) };
  const service = createCaptureService({
    holds,
    settlements,
    accounts,
    mercadoPago: mp as unknown as MercadoPagoClient,
    ledger,
    log: silentLog,
    now: () => NOW,
  });
  return { service, holds, settlements, mp, accounts, ledger };
}

async function expectApiError(promise: Promise<unknown>, statusCode: number, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(error).toBeInstanceOf(ApiError);
  expect((error as ApiError).statusCode).toBe(statusCode);
  expect((error as ApiError).code).toBe(code);
}

describe("readFeeBreakdown", () => {
  it("separa la comisión de Movo del fee de MP y toma el neto de MP", () => {
    const b = readFeeBreakdown(payment(), D(150));
    expect(b?.mpFeeArs.toString()).toBe("41");
    expect(b?.commissionArs.toString()).toBe("150");
    expect(b?.netAmountArs.toString()).toBe("809");
  });

  it("devuelve null mientras MP no trae el desglose (pago sin capturar)", () => {
    expect(readFeeBreakdown(payment({ fee_details: [] }), D(150))).toBeNull();
    expect(readFeeBreakdown(payment({ transaction_details: {} }), D(150))).toBeNull();
  });

  it("bruto = fee de MP + comisión + neto con montos que no dividen exacto", () => {
    // 1153.37: 4.1% de MP = 47.2882 -> 47.29, y la comisión sale de un neto redondeado.
    const b = readFeeBreakdown(
      payment({
        fee_details: [
          { type: "mercadopago_fee", amount: 47.29 },
          { type: "application_fee", amount: 150.44 },
        ],
        transaction_details: { net_received_amount: 955.64 },
      }),
      D(150.44)
    );
    expect(b).not.toBeNull();
    const total = b!.mpFeeArs.plus(b!.commissionArs).plus(b!.netAmountArs);
    // Decimal exacto: con floats 47.29 + 150.44 + 955.64 daría 1153.3700000000001.
    expect(total.equals(D("1153.37"))).toBe(true);
  });
});

describe("createCaptureService.capture", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    vi.clearAllMocks();
    ctx = setup();
  });

  it("captura sin amount (AC3), persiste el desglose real (AC4) y marca el hold captured", async () => {
    const { settlement, replayed } = await ctx.service.capture(SHIPMENT);

    expect(replayed).toBe(false);
    expect(ctx.mp.capturePayment).toHaveBeenCalledTimes(1);
    expect(ctx.mp.capturePayment).toHaveBeenCalledWith("TEST-access", MP_PAYMENT, {
      idempotencyKey: `movo-hold-capture-${HOLD_ID}`,
    });
    expect(settlement).toMatchObject({
      status: "credited",
      grossAmountArs: 1000,
      mpFeeArs: 41,
      commissionArs: 150,
      netAmountArs: 809,
      failureReason: null,
      mpPaymentId: MP_PAYMENT,
    });
    expect(settlement.capturedAt).toBe(NOW.toISOString());
    expect(ctx.holds.hold?.status).toBe("captured");
    expect(ctx.holds.hold?.expiresAt).toBeNull();
  });

  it("si el webhook movió el hold mientras se capturaba, no lo pisa pero acredita igual (MP ya cobró)", async () => {
    ctx.mp.capturePayment.mockImplementationOnce(async () => {
      Object.assign(ctx.holds.hold as Hold, { status: "cancelled" });
      return payment();
    });

    const { settlement } = await ctx.service.capture(SHIPMENT);

    expect(settlement.status).toBe("credited");
    expect(ctx.holds.hold?.status).toBe("cancelled");
  });

  it("AC7: una segunda invocación no captura de nuevo ni duplica la liquidación", async () => {
    await ctx.service.capture(SHIPMENT);
    const second = await ctx.service.capture(SHIPMENT);

    expect(second.replayed).toBe(true);
    expect(second.settlement.status).toBe("credited");
    expect(ctx.mp.capturePayment).toHaveBeenCalledTimes(1);
    expect(ctx.settlements.creates).toBe(1);
  });

  it("AC7: dos pedidos simultáneos usan la misma key de MP y comparten una sola fila", async () => {
    const [a, b] = await Promise.all([ctx.service.capture(SHIPMENT), ctx.service.capture(SHIPMENT)]);

    expect(ctx.settlements.creates).toBe(1);
    const keys = ctx.mp.capturePayment.mock.calls.map((call) => (call as unknown[])[2]);
    expect(new Set(keys.map((k) => JSON.stringify(k))).size).toBe(1);
    expect(a.settlement.id).toBe(b.settlement.id);
  });

  it("un hold ya captured (se cortó antes del desglose) no vuelve a capturar: completa la liquidación", async () => {
    ctx = setup({ hold: makeHold({ status: "captured", expiresAt: null }) });
    const { settlement } = await ctx.service.capture(SHIPMENT);

    expect(ctx.mp.capturePayment).not.toHaveBeenCalled();
    expect(settlement.status).toBe("credited");
  });

  it("si la captura falla pero MP ya había cobrado (approved), lo adopta sin error", async () => {
    ctx.mp.capturePayment.mockRejectedValueOnce({ status: 500, message: "timeout" });
    const { settlement } = await ctx.service.capture(SHIPMENT);

    expect(settlement.status).toBe("credited");
    expect(ctx.mp.capturePayment).toHaveBeenCalledTimes(1);
  });

  it("AC8: un fallo de MP deja la liquidación failed y el hold intacto (nunca revierte)", async () => {
    ctx.mp.capturePayment.mockRejectedValue({ status: 500, message: "boom" });
    ctx.mp.getPayment.mockResolvedValue(payment({ status: "authorized", fee_details: [] }));

    await expectApiError(ctx.service.capture(SHIPMENT), 502, "PAYMENT_PROVIDER_ERROR");

    expect(ctx.settlements.row?.status).toBe("failed");
    expect(ctx.settlements.row?.failureReason).toBe("provider_error");
    expect(ctx.holds.hold?.status).toBe("authorized");
  });

  it("un fallo se puede reintentar: la fila vuelve a processing y termina credited", async () => {
    ctx.mp.capturePayment.mockRejectedValueOnce({ status: 500, message: "boom" });
    ctx.mp.getPayment.mockResolvedValueOnce(payment({ status: "authorized", fee_details: [] }));
    await expectApiError(ctx.service.capture(SHIPMENT), 502, "PAYMENT_PROVIDER_ERROR");

    const retry = await ctx.service.capture(SHIPMENT);

    expect(retry.settlement.status).toBe("credited");
    expect(ctx.settlements.creates).toBe(1);
  });

  it("hold vencido en MP: liquidación failed hold_expired y 409 HOLD_NOT_CAPTURABLE", async () => {
    ctx.mp.capturePayment.mockRejectedValue({ status: 400, message: "expired" });
    ctx.mp.getPayment.mockResolvedValue(payment({ status: "cancelled", fee_details: [] }));

    await expectApiError(ctx.service.capture(SHIPMENT), 409, "HOLD_NOT_CAPTURABLE");

    expect(ctx.settlements.row?.failureReason).toBe("hold_expired");
    expect(ctx.holds.hold?.status).toBe("authorized");
  });

  it("401/403 de MP: 409 CARRIER_MP_ACCOUNT_NOT_LINKED", async () => {
    ctx.mp.capturePayment.mockRejectedValue({ status: 401, message: "unauthorized" });
    ctx.mp.getPayment.mockRejectedValue({ status: 401 });

    await expectApiError(ctx.service.capture(SHIPMENT), 409, "CARRIER_MP_ACCOUNT_NOT_LINKED");
    expect(ctx.settlements.row?.failureReason).toBe("carrier_account_unavailable");
  });

  it("sin credenciales del transportista no llama a MP y deja la liquidación failed", async () => {
    ctx = setup({ credentials: false });

    await expectApiError(ctx.service.capture(SHIPMENT), 409, "CARRIER_MP_ACCOUNT_NOT_LINKED");

    expect(ctx.mp.capturePayment).not.toHaveBeenCalled();
    expect(ctx.settlements.row?.status).toBe("failed");
  });

  it("captura cobrada pero sin desglose todavía: queda processing y el próximo pedido lo completa", async () => {
    ctx.mp.getPayment.mockResolvedValueOnce(payment({ fee_details: [] }));
    await expectApiError(ctx.service.capture(SHIPMENT), 502, "PAYMENT_PROVIDER_ERROR");
    expect(ctx.settlements.row?.status).toBe("processing");

    // Falló el desglose pero MP ya cobró: el hold no se marcó, el reintento adopta el pago.
    ctx.mp.capturePayment.mockRejectedValueOnce({ status: 409, message: "already captured" });
    const retry = await ctx.service.capture(SHIPMENT);
    expect(retry.settlement.status).toBe("credited");
  });

  it.each(["creating", "in_process", "cancelled", "rejected"] as const)(
    "un hold %s no se puede capturar",
    async (status) => {
      ctx = setup({ hold: makeHold({ status }) });
      await expectApiError(ctx.service.capture(SHIPMENT), 409, "HOLD_NOT_CAPTURABLE");
      expect(ctx.mp.capturePayment).not.toHaveBeenCalled();
      expect(ctx.settlements.row).toBeNull();
    }
  );

  it("envío sin hold: 404 HOLD_NOT_FOUND", async () => {
    ctx = setup({ hold: null });
    await expectApiError(ctx.service.capture(SHIPMENT), 404, "HOLD_NOT_FOUND");
  });
});

describe("createCaptureService: fallos permanentes y carreras (review de PR #235)", () => {
  const LATER = new Date("2026-10-12T00:00:00.000Z");

  it("un fallo tardío no pisa una liquidación que otro llamador ya acreditó", async () => {
    const ctx = setup();
    // La captura en línea (A) ya acreditó mientras este reintento (B) hacía timeout.
    ctx.mp.capturePayment.mockImplementationOnce(async () => {
      Object.assign(ctx.settlements.row as Settlement, { status: "credited" });
      throw { status: 500, message: "timeout" };
    });
    ctx.mp.getPayment.mockRejectedValue({ status: 500 });

    const result = await ctx.service.capture(SHIPMENT);

    expect(result.replayed).toBe(true);
    expect(result.settlement.status).toBe("credited");
    expect(ctx.settlements.row?.status).toBe("credited");
  });

  it("hold_expired es permanente: la siguiente llamada no vuelve a processing ni le pega a MP", async () => {
    const ctx = setup();
    ctx.mp.capturePayment.mockRejectedValue({ status: 400, message: "expired" });
    ctx.mp.getPayment.mockResolvedValue(payment({ status: "cancelled", fee_details: [] }));
    await expectApiError(ctx.service.capture(SHIPMENT), 409, "HOLD_NOT_CAPTURABLE");
    ctx.mp.capturePayment.mockClear();
    ctx.mp.getPayment.mockClear();

    await expectApiError(ctx.service.capture(SHIPMENT), 409, "HOLD_NOT_CAPTURABLE");

    expect(ctx.mp.capturePayment).not.toHaveBeenCalled();
    expect(ctx.mp.getPayment).not.toHaveBeenCalled();
    expect(ctx.settlements.row?.status).toBe("failed");
  });

  it("credenciales rechazadas: no se reintenta con el mismo token, pero sí cuando el transportista se re-vincula", async () => {
    const ctx = setup({ account: { updatedAt: new Date("2026-10-01T00:00:00.000Z") } });
    ctx.settlements.clock = () => LATER;
    ctx.mp.capturePayment.mockRejectedValue({ status: 401, message: "unauthorized" });
    ctx.mp.getPayment.mockRejectedValue({ status: 401 });
    await expectApiError(ctx.service.capture(SHIPMENT), 409, "CARRIER_MP_ACCOUNT_NOT_LINKED");
    ctx.mp.capturePayment.mockClear();

    // Sin cambios en la vinculación: corta sin llamar a MP.
    await expectApiError(ctx.service.capture(SHIPMENT), 409, "CARRIER_MP_ACCOUNT_NOT_LINKED");
    expect(ctx.mp.capturePayment).not.toHaveBeenCalled();
    expect(ctx.settlements.row?.status).toBe("failed");

    // El transportista se re-vincula después del fallo: se reintenta con las credenciales nuevas.
    const relinked = setup({ account: { updatedAt: new Date("2026-10-13T00:00:00.000Z") } });
    relinked.settlements.row = ctx.settlements.row;
    relinked.settlements.clock = () => LATER;
    const retry = await relinked.service.capture(SHIPMENT);
    expect(retry.settlement.status).toBe("credited");
  });

  it("token vencido: falla sin llamar a MP, aun en la primera captura", async () => {
    const ctx = setup({ account: { tokenExpiresAt: new Date("2026-10-09T00:00:00.000Z") } });

    await expectApiError(ctx.service.capture(SHIPMENT), 409, "CARRIER_MP_ACCOUNT_NOT_LINKED");

    expect(ctx.mp.capturePayment).not.toHaveBeenCalled();
    expect(ctx.settlements.row).toMatchObject({ status: "failed", failureReason: "carrier_account_unavailable" });
  });

  it("un fallo transitorio sí se sigue reintentando", async () => {
    const ctx = setup();
    ctx.mp.capturePayment.mockRejectedValueOnce({ status: 500, message: "boom" });
    ctx.mp.getPayment.mockResolvedValueOnce(payment({ status: "authorized", fee_details: [] }));
    await expectApiError(ctx.service.capture(SHIPMENT), 502, "PAYMENT_PROVIDER_ERROR");
    expect(ctx.settlements.row?.failureReason).toBe("provider_error");

    expect((await ctx.service.capture(SHIPMENT)).settlement.status).toBe("credited");
  });
});

describe("readFeeBreakdown: quién paga cada cargo", () => {
  const dec = (n: number) => new Prisma.Decimal(n);

  it("un cargo que paga el comprador (cuotas) no entra en la comisión de MP del transportista", () => {
    const breakdown = readFeeBreakdown(
      payment({
        transaction_amount: 1000,
        fee_details: [
          { type: "mercadopago_fee", amount: 41, fee_payer: "collector" },
          { type: "application_fee", amount: 150, fee_payer: "collector" },
          { type: "financing_fee", amount: 63.2, fee_payer: "payer" },
        ],
        transaction_details: { net_received_amount: 809 },
      }),
      dec(150)
    );

    expect(breakdown).not.toBeNull();
    expect(breakdown!.mpFeeArs.toString()).toBe("41");
    expect(breakdown!.commissionArs.toString()).toBe("150");
    // Bruto = comisión de MP + comisión de Movo + neto: sigue cerrando.
    expect(breakdown!.mpFeeArs.plus(breakdown!.commissionArs).plus(breakdown!.netAmountArs).toString()).toBe("1000");
  });

  it("una entrada sin fee_payer (respuestas viejas) se toma como del vendedor", () => {
    const breakdown = readFeeBreakdown(
      payment({ fee_details: [{ type: "mercadopago_fee", amount: 41 }, { type: "application_fee", amount: 150 }] }),
      dec(150)
    );
    expect(breakdown!.mpFeeArs.toString()).toBe("41");
  });
});

describe("createCaptureService.getByShipment", () => {
  it("404 SETTLEMENT_NOT_FOUND si todavía no se pidió la captura", async () => {
    const { service } = setup();
    await expectApiError(service.getByShipment(SHIPMENT), 404, "SETTLEMENT_NOT_FOUND");
  });

  it("devuelve la liquidación acreditada", async () => {
    const { service } = setup();
    await service.capture(SHIPMENT);
    const settlement = await service.getByShipment(SHIPMENT);
    expect(settlement).toMatchObject({ status: "credited", netAmountArs: 809 });
  });
});

describe("deuda de la cuenta corriente cobrada en la captura (MOVO-311)", () => {
  // Precio 1000, comisión 150, deuda del transportista 100 y recargo del emisor 200 (fee de MP 9,98 absorbido).
  const debtHold = () =>
    makeHold({
      amountArs: D(1200),
      applicationFeeArs: D("440.02"),
      commissionArs: D(150),
      debtOffsetArs: D(100),
      debtSurchargeArs: D(200),
    });

  it("si MP retiene lo pedido, la comisión queda sola y la deuda se asienta completa", () => {
    const split = splitRetainedFee(debtHold(), D("440.02"));
    expect(split.commissionArs.toString()).toBe("150");
    expect(split.debtOffsetArs.toString()).toBe("100");
    expect(split.debtSurchargeArs.toString()).toBe("200");
    expect(split.debtSurchargeFeeArs.toString()).toBe("190.02");
  });

  it("si MP retiene menos, el faltante sale primero del recargo y después del descuento", () => {
    // Retuvo 345,01: comisión 150 + descuento 100 + la mitad del fee del recargo (95,01 de 190,02).
    const split = splitRetainedFee(debtHold(), D("345.01"));
    expect(split.commissionArs.toString()).toBe("150");
    expect(split.debtOffsetArs.toString()).toBe("100");
    expect(split.debtSurchargeArs.toString()).toBe("100");

    const less = splitRetainedFee(debtHold(), D(200));
    expect(less.debtOffsetArs.toString()).toBe("50");
    expect(less.debtSurchargeArs.toString()).toBe("0");
  });

  it("al capturar asienta la deuda antes de acreditar y separa la comisión en la liquidación", async () => {
    const { service, ledger, mp } = setup({ hold: debtHold() });
    const captured = payment({
      transaction_amount: 1200,
      fee_details: [
        { type: "mercadopago_fee", amount: 59.88, fee_payer: "collector" },
        { type: "application_fee", amount: 440.02, fee_payer: "collector" },
      ],
      transaction_details: { net_received_amount: 700.1 },
    });
    mp.capturePayment.mockResolvedValue(captured);
    mp.getPayment.mockResolvedValue(captured);

    const { settlement } = await service.capture(SHIPMENT);

    expect(ledger.settleHoldDebt).toHaveBeenCalledTimes(1);
    const [holdId, settled] = ledger.settleHoldDebt.mock.calls[0] as unknown as [
      string,
      { type: string; amountArs: Prisma.Decimal }[],
    ];
    expect(holdId).toBe(HOLD_ID);
    expect(settled.map((s) => [s.type, s.amountArs.toString()])).toEqual([
      ["fee_offset", "100"],
      ["payment_surcharge", "200"],
    ]);
    expect(settlement).toMatchObject({
      status: "credited",
      grossAmountArs: 1200,
      commissionArs: 150,
      debtOffsetArs: 100,
      debtSurchargeArs: 200,
      // Lo que ve el transportista: el bruto sin el recargo y el fee de MP sin la parte que cae sobre él.
      carrierGrossAmountArs: 1000,
      netAmountArs: 700.1,
    });
    expect(settlement.carrierMpFeeArs).toBeCloseTo((settlement.mpFeeArs as number) - (200 - 190.02), 2);
  });

  it("si asentar la deuda falla, la liquidación no se acredita y el reintento la completa", async () => {
    const { service, ledger, settlements } = setup({ hold: debtHold() });
    ledger.settleHoldDebt.mockRejectedValueOnce(new Error("db caída"));
    await expect(service.capture(SHIPMENT)).rejects.toThrow("db caída");
    expect(settlements.row?.status).toBe("processing");

    const { settlement } = await service.capture(SHIPMENT);
    expect(settlement.status).toBe("credited");
    expect(ledger.settleHoldDebt).toHaveBeenCalledTimes(2);
  });

  it("un hold sin deuda no toca la cuenta corriente", async () => {
    const { service, ledger } = setup();
    await service.capture(SHIPMENT);
    expect(ledger.settleHoldDebt).not.toHaveBeenCalled();
  });
});
