import { describe, it, expect, beforeEach, vi } from "vitest";
import { ApiError, HoldResponse, ShipmentStatus } from "@movo/shared";
import { createSettlementService } from "../src/modules/settlements/settlement.service";
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
      status: "credited",
      paidAmountArs: 1000,
      paidAt: expect.any(String),
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
      20
    );
  });
});
