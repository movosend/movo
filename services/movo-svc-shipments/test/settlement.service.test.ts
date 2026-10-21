import { describe, it, expect, beforeEach, vi } from "vitest";
import { ApiError, HoldResponse, ShipmentStatus } from "@movo/shared";
import { createSettlementService, SettlementRetryState, settlementRetryCooldownSeconds } from "../src/modules/settlements/settlement.service";
import { createPaymentsFundsReleaseNotifier } from "../src/adapters/payments-funds-release-notifier";
import { InvalidShipmentTransitionError } from "../src/domain/shipment-state-machine";
import { ShipmentConcurrentModificationError } from "../src/repositories/shipment-repository";
import type { Shipment, ShipmentRepository } from "../src/repositories/shipment-repository";
import { createFakePaymentsClient, FakePaymentsClient } from "./fake-payments-client";
import { createFakeNotificationsClient } from "./fake-notifications-client";

// Ids ficticios, nada de cuentas reales en fixtures versionados.
const SHIPMENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SENDER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CARRIER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const RECEIVER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

/** Repo mínimo en memoria: solo lo que usa el servicio, con el CAS real de `updateStatus`. */
function memoryRepository(initial: Partial<Shipment> = {}) {
  const shipment = {
    id: SHIPMENT,
    senderId: SENDER,
    carrierId: CARRIER,
    receiverId: RECEIVER,
    status: ShipmentStatus.DELIVERED,
    deliveredAt: new Date("2030-01-05T00:00:00.000Z"),
    ...initial,
  } as Shipment;
  const repository = {
    findById: vi.fn(async () => shipment),
    updateStatus: vi.fn(
      async (_id: string, to: ShipmentStatus, _actor: string | null, _reason?: string, options?: { expectedFrom?: ShipmentStatus }) => {
        if (options?.expectedFrom !== undefined && options.expectedFrom !== shipment.status) {
          throw new ShipmentConcurrentModificationError(SHIPMENT);
        }
        shipment.status = to;
        return shipment;
      }
    ),
    listDeliveredAwaitingSettlement: vi.fn(async () => [shipment]),
  };
  return { shipment, repository };
}

function seedHold(payments: FakePaymentsClient, overrides: Partial<HoldResponse> = {}) {
  payments.holds.set(SHIPMENT, {
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    shipmentId: SHIPMENT,
    carrierId: CARRIER,
    attempt: 1,
    mpPaymentId: "mp-1",
    collectorId: "1000000001",
    amountArs: 1000,
    applicationFeeArs: 150,
    baseAmountArs: 1000,
    commissionArs: 150,
    debtOffsetArs: 0,
    debtSurchargeArs: 0,
    status: "authorized",
    statusDetail: "pending_capture",
    failureReason: null,
    expiresAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  });
}

function setup(shipment: Partial<Shipment> = {}) {
  const { shipment: row, repository } = memoryRepository(shipment);
  const payments = createFakePaymentsClient();
  seedHold(payments);
  const notifications = createFakeNotificationsClient();
  const claimed = new Set<string>();
  const service = createSettlementService({
    repository: repository as unknown as ShipmentRepository,
    paymentsClient: payments,
    notificationsClient: notifications,
    claimNotificationOnce: async (key) => (claimed.has(key) ? false : (claimed.add(key), true)),
    logger: { warn: vi.fn(), info: vi.fn() },
    now: () => new Date("2030-01-05T01:00:00.000Z"),
  });
  return { service, row, repository, payments, notifications };
}

describe("settlement.service.captureAndComplete (MOVO-212)", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it("AC5: con la captura acreditada el envío pasa delivered -> completed (CAS contra delivered)", async () => {
    const outcome = await ctx.service.captureAndComplete(SHIPMENT);

    expect(outcome).toBe("completed");
    expect(ctx.payments.captureHold).toHaveBeenCalledWith(SHIPMENT);
    expect(ctx.row.status).toBe(ShipmentStatus.COMPLETED);
    expect(ctx.repository.updateStatus).toHaveBeenCalledWith(
      SHIPMENT,
      ShipmentStatus.COMPLETED,
      null,
      expect.any(String),
      { expectedFrom: ShipmentStatus.DELIVERED }
    );
  });

  it("AC6: avisa al transportista con el monto acreditado y al emisor que el pago se procesó", async () => {
    await ctx.service.captureAndComplete(SHIPMENT);

    const calls = (ctx.notifications.sendPush as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    const carrierPush = calls.find((c) => c.userId === CARRIER);
    const senderPush = calls.find((c) => c.userId === SENDER);
    // 1000 - 41 (MP) - 150 (Movo) = 809
    expect(carrierPush.body).toContain("809");
    expect(carrierPush.category).toBe("payments");
    expect(senderPush.title).toBe("Pago procesado");
    expect(senderPush.body).not.toMatch(/\d{3}/);
    expect(calls).toHaveLength(2);
  });

  it("AC7: una segunda invocación no captura de nuevo ni repite los pushes", async () => {
    await ctx.service.captureAndComplete(SHIPMENT);
    const second = await ctx.service.captureAndComplete(SHIPMENT);

    expect(second).toBe("already_completed");
    expect(ctx.payments.captureHold).toHaveBeenCalledTimes(1);
    expect(ctx.notifications.sendPush).toHaveBeenCalledTimes(2);
  });

  it("AC7: dos invocaciones simultáneas completan una vez y avisan una vez", async () => {
    const outcomes = await Promise.all([
      ctx.service.captureAndComplete(SHIPMENT),
      ctx.service.captureAndComplete(SHIPMENT),
    ]);

    expect(ctx.row.status).toBe(ShipmentStatus.COMPLETED);
    expect(outcomes).toContain("completed");
    expect(ctx.notifications.sendPush).toHaveBeenCalledTimes(2);
  });

  it("AC8: si la captura falla el envío queda en delivered y nunca se toca el estado", async () => {
    ctx.payments.behavior.captureError = new ApiError(502, "PAYMENT_PROVIDER_ERROR", "MP no respondió");

    await expect(ctx.service.captureAndComplete(SHIPMENT)).rejects.toMatchObject({ code: "PAYMENT_PROVIDER_ERROR" });

    expect(ctx.row.status).toBe(ShipmentStatus.DELIVERED);
    expect(ctx.repository.updateStatus).not.toHaveBeenCalled();
    expect(ctx.notifications.sendPush).not.toHaveBeenCalled();
  });

  it("AC8: reintentar tras un fallo completa el envío", async () => {
    ctx.payments.behavior.captureError = new ApiError(502, "PAYMENT_PROVIDER_ERROR", "MP no respondió");
    await expect(ctx.service.captureAndComplete(SHIPMENT)).rejects.toBeInstanceOf(ApiError);
    ctx.payments.behavior.captureError = null;

    expect(await ctx.service.captureAndComplete(SHIPMENT)).toBe("completed");
  });

  it("si la transición pierde la carrera y el envío ya está completed, lo da por cumplido", async () => {
    ctx.repository.updateStatus.mockImplementationOnce(async () => {
      ctx.row.status = ShipmentStatus.COMPLETED;
      throw new InvalidShipmentTransitionError(ShipmentStatus.COMPLETED, ShipmentStatus.COMPLETED);
    });

    expect(await ctx.service.captureAndComplete(SHIPMENT)).toBe("already_completed");
    expect(ctx.notifications.sendPush).not.toHaveBeenCalled();
  });

  it.each([
    ShipmentStatus.IN_TRANSIT,
    ShipmentStatus.DISPUTED,
    ShipmentStatus.CANCELLED,
  ])("un envío %s no se captura", async (status) => {
    ctx = setup({ status });
    expect(await ctx.service.captureAndComplete(SHIPMENT)).toBe("skipped");
    expect(ctx.payments.captureHold).not.toHaveBeenCalled();
  });

  it("un push que falla no rompe el cierre", async () => {
    (ctx.notifications.sendPush as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("push caído"));
    expect(await ctx.service.captureAndComplete(SHIPMENT)).toBe("completed");
  });
});

describe("FundsReleaseNotifier real", () => {
  it("al notificar la entrega captura y completa el envío", async () => {
    const ctx = setup();
    await createPaymentsFundsReleaseNotifier(ctx.service).notify({ shipmentId: SHIPMENT, carrierId: CARRIER });
    expect(ctx.row.status).toBe(ShipmentStatus.COMPLETED);
  });
});

describe("settlement.service.getForUser (AC10)", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(async () => {
    ctx = setup();
    await ctx.service.captureAndComplete(SHIPMENT);
  });

  it("el transportista ve bruto, fee de MP, comisión y neto", async () => {
    const view = await ctx.service.getForUser(SHIPMENT, CARRIER);
    expect(view).toMatchObject({
      role: "carrier",
      status: "credited",
      paidAmountArs: 1000,
      mpFeeArs: 41,
      commissionArs: 150,
      netAmountArs: 809,
    });
    expect(view.paidAt).not.toBeNull();
  });

  it("el emisor ve solo el total pagado y la fecha", async () => {
    const view = await ctx.service.getForUser(SHIPMENT, SENDER);
    expect(view).toEqual({
      shipmentId: SHIPMENT,
      role: "sender",
      kind: "delivery",
      status: "credited",
      paidAmountArs: 1000,
      paidAt: expect.any(String),
      debtCollectedArs: 0,
    });
    expect(view).not.toHaveProperty("commissionArs");
    expect(view).not.toHaveProperty("netAmountArs");
    expect(view).not.toHaveProperty("mpFeeArs");
  });

  it("el receptor y un ajeno reciben 403", async () => {
    await expect(ctx.service.getForUser(SHIPMENT, RECEIVER)).rejects.toMatchObject({ statusCode: 403 });
    await expect(ctx.service.getForUser(SHIPMENT, "ffffffff-ffff-4fff-8fff-ffffffffffff")).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("failed se ve como processing, y sin liquidación es 404", async () => {
    ctx.payments.settlements.set(SHIPMENT, {
      ...ctx.payments.settlements.get(SHIPMENT)!,
      status: "failed",
      capturedAt: null,
    });
    const view = await ctx.service.getForUser(SHIPMENT, SENDER);
    expect(view.status).toBe("processing");
    expect(view.paidAt).toBeNull();

    ctx.payments.settlements.delete(SHIPMENT);
    await expect(ctx.service.getForUser(SHIPMENT, SENDER)).rejects.toMatchObject({ code: "SETTLEMENT_NOT_FOUND" });
  });
});

describe("settlement.service.retryPendingSettlements", () => {
  it("reintenta los delivered pendientes y un fallo no frena el barrido", async () => {
    const ctx = setup();
    ctx.payments.behavior.captureError = new ApiError(502, "PAYMENT_PROVIDER_ERROR", "caído");
    await expect(ctx.service.retryPendingSettlements({ graceMinutes: 5, batchSize: 20 })).resolves.toBeUndefined();
    expect(ctx.row.status).toBe(ShipmentStatus.DELIVERED);

    ctx.payments.behavior.captureError = null;
    await ctx.service.retryPendingSettlements({ graceMinutes: 5, batchSize: 20 });
    expect(ctx.row.status).toBe(ShipmentStatus.COMPLETED);
    // El margen se resta de "ahora": 01:00 - 5 min.
    expect(ctx.repository.listDeliveredAwaitingSettlement).toHaveBeenCalledWith(
      new Date("2030-01-05T00:55:00.000Z"),
      20,
      undefined
    );
  });
});

/** Envíos entregados sueltos para probar la paginación y el enfriamiento del barrido. */
function sweepSetup(count: number, retryState: SettlementRetryState) {
  const shipments = Array.from({ length: count }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    senderId: SENDER,
    carrierId: CARRIER,
    receiverId: RECEIVER,
    status: ShipmentStatus.DELIVERED,
    deliveredAt: new Date(Date.UTC(2030, 0, 1, 0, i)),
  })) as Shipment[];
  const captured: string[] = [];
  const repository = {
    findById: vi.fn(async (id: string) => shipments.find((s) => s.id === id) ?? null),
    updateStatus: vi.fn(async (id: string) => {
      const s = shipments.find((x) => x.id === id)!;
      s.status = ShipmentStatus.COMPLETED;
      return s;
    }),
    // Keyset real: ordenado por (deliveredAt, id) y a partir del cursor.
    listDeliveredAwaitingSettlement: vi.fn(
      async (_before: Date, limit: number, after?: { deliveredAt: Date; id: string }) =>
        shipments
          .filter((s) => s.status === ShipmentStatus.DELIVERED)
          .filter((s) => !after || s.deliveredAt! > after.deliveredAt || (+s.deliveredAt! === +after.deliveredAt && s.id > after.id))
          .slice(0, limit)
    ),
  };
  const payments = createFakePaymentsClient();
  const failing = new Set<string>();
  payments.captureHold.mockImplementation(async (shipmentId: string) => {
    captured.push(shipmentId);
    if (failing.has(shipmentId)) throw new ApiError(502, "PAYMENT_PROVIDER_ERROR", "caído");
    return {
      id: "s", shipmentId, holdId: "h", carrierId: CARRIER, mpPaymentId: "mp", status: "credited",
      grossAmountArs: 1000, mpFeeArs: 41, commissionArs: 150, netAmountArs: 809,
      failureReason: null, capturedAt: new Date().toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    } as never;
  });
  const service = createSettlementService({
    repository: repository as unknown as ShipmentRepository,
    paymentsClient: payments,
    logger: { warn: vi.fn(), info: vi.fn() },
    retryState,
    now: () => new Date("2030-02-01T00:00:00.000Z"),
  });
  return { service, shipments, captured, failing, repository, payments };
}

function memoryRetryState(): SettlementRetryState & { cooling: Set<string>; failures: Array<[string, boolean]> } {
  const cooling = new Set<string>();
  const failures: Array<[string, boolean]> = [];
  return {
    cooling,
    failures,
    isCoolingDown: async (id) => cooling.has(id),
    recordFailure: async (id, permanent) => {
      cooling.add(id);
      failures.push([id, permanent]);
    },
    clear: async (id) => {
      cooling.delete(id);
    },
  };
}

describe("settlement.service.retryPendingSettlements: barrido que no se traba (review de PR #235)", () => {
  it("20 envíos imposibles de capturar no tapan a uno nuevo con un fallo transitorio", async () => {
    const retryState = memoryRetryState();
    const ctx = sweepSetup(21, retryState);
    // Los 20 más viejos nunca se pueden capturar; el 21° (el más nuevo) se cobra bien.
    for (const s of ctx.shipments.slice(0, 20)) ctx.failing.add(s.id);

    await ctx.service.retryPendingSettlements({ graceMinutes: 5, batchSize: 20 });
    // Primera pasada: intentó los 20 viejos, todos fallaron y quedaron enfriándose.
    expect(retryState.cooling.size).toBe(20);
    expect(ctx.shipments[20].status).toBe(ShipmentStatus.DELIVERED);

    ctx.captured.length = 0;
    await ctx.service.retryPendingSettlements({ graceMinutes: 5, batchSize: 20 });

    // Segunda pasada: salta los enfriados, pagina hasta el 21° y lo cobra.
    expect(ctx.captured).toEqual([ctx.shipments[20].id]);
    expect(ctx.shipments[20].status).toBe(ShipmentStatus.COMPLETED);
  });

  it("distingue el fallo permanente (sin hold / hold no capturable) del transitorio al enfriar", async () => {
    const retryState = memoryRetryState();
    const ctx = sweepSetup(3, retryState);
    ctx.failing.add(ctx.shipments[1].id); // transitorio: 502
    ctx.payments.captureHold.mockImplementation(async (shipmentId: string) => {
      if (shipmentId === ctx.shipments[0].id) throw new ApiError(404, "HOLD_NOT_FOUND", "sin hold");
      if (shipmentId === ctx.shipments[1].id) throw new ApiError(502, "PAYMENT_PROVIDER_ERROR", "caído");
      return { status: "credited", id: "s", netAmountArs: 809 } as never;
    });

    await ctx.service.retryPendingSettlements({ graceMinutes: 5, batchSize: 20 });

    expect(retryState.failures).toEqual([
      [ctx.shipments[0].id, true],
      [ctx.shipments[1].id, false],
    ]);
    expect(ctx.shipments[2].status).toBe(ShipmentStatus.COMPLETED);
  });

  it("un envío que se cobra bien sale del enfriamiento", async () => {
    const retryState = memoryRetryState();
    const ctx = sweepSetup(1, retryState);
    retryState.cooling.add(ctx.shipments[0].id);
    retryState.cooling.delete(ctx.shipments[0].id);

    await ctx.service.retryPendingSettlements({ graceMinutes: 5, batchSize: 20 });

    expect(ctx.shipments[0].status).toBe(ShipmentStatus.COMPLETED);
    expect(retryState.cooling.size).toBe(0);
  });
});

describe("settlementRetryCooldownSeconds", () => {
  it("duplica por intento hasta el tope de 6 h, y un fallo permanente espera 24 h", () => {
    expect(settlementRetryCooldownSeconds(1, false)).toBe(10 * 60);
    expect(settlementRetryCooldownSeconds(2, false)).toBe(20 * 60);
    expect(settlementRetryCooldownSeconds(3, false)).toBe(40 * 60);
    expect(settlementRetryCooldownSeconds(20, false)).toBe(6 * 60 * 60);
    expect(settlementRetryCooldownSeconds(1, true)).toBe(24 * 60 * 60);
  });
});

describe("settlement.service.getForUser: deuda cobrada (MOVO-311)", () => {
  it("cada parte ve solo la deuda que saldó: el transportista el descuento, el emisor el recargo", async () => {
    const ctx = setup({ status: ShipmentStatus.DELIVERED });
    seedHold(ctx.payments, {
      amountArs: 1200,
      applicationFeeArs: 440.02,
      commissionArs: 150,
      debtOffsetArs: 100,
      debtSurchargeArs: 200,
    });
    await ctx.payments.captureHold(SHIPMENT);

    const carrier = await ctx.service.getForUser(SHIPMENT, CARRIER);
    // Sin el recargo del emisor: bruto = 1000 y el fee de MP sin la parte del recargo que absorbe Movo, así
    // bruto − fee MP − comisión − deuda propia cierra contra el neto.
    expect(carrier).toMatchObject({ commissionArs: 150, debtCollectedArs: 100, paidAmountArs: 1000 });
    const mpFee = carrier.mpFeeArs as number;
    expect(Math.round((1000 - mpFee - 150 - 100) * 100) / 100).toBe(carrier.netAmountArs);

    const sender = await ctx.service.getForUser(SHIPMENT, SENDER);
    expect(sender).toMatchObject({ debtCollectedArs: 200, paidAmountArs: 1200 });
    expect(sender).not.toHaveProperty("commissionArs");
  });
});
