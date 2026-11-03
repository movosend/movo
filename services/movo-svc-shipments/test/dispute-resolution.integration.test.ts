import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import {
  ApiError,
  DisputeOutcome,
  DisputePaymentAction,
  DisputeReason,
  DisputeStatus,
  OfferStatus,
  SettlementResponse,
  ShipmentStatus,
} from "@movo/shared";
import { buildApp } from "../src/app";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { CreateShipmentInput, PackageType, PhotoStage } from "../src/models/shipment";
import { createFakeUsersClient } from "./fake-users-client";
import { createFakePaymentsClient, FakePaymentsClient } from "./fake-payments-client";

/**
 * MOVO-337 (DD-056): resolución de disputas, `POST /internal/admin/disputes/:id/resolve`. Postgres y Redis reales,
 * payments con el fake. Una prueba por cada celda de la matriz (resultado × estado al abrirse), la idempotencia, el
 * fallo de la acción de pago (AC7), el desbloqueo del transportista (AC9), los pushes (AC11) y la regla de quién
 * califica un envío no entregado (AC12).
 */

const AGREED_PRICE = 1150;
/** Neto del transportista (precio acordado menos la comisión de Movo del 15 %): lo que está en juego en un no-retiro. */
const NET_PRICE = 1000;
const REASONING = "Revisamos las fotos, el handshake y el chat de las partes";

const FAR_WINDOW = {
  pickupDate: new Date("2031-06-01T00:00:00.000Z"),
  pickupTimeWindowStart: new Date("1970-01-01T14:00:00.000Z"),
  pickupTimeWindowEnd: new Date("1970-01-01T18:00:00.000Z"),
};

type Origin = "assigned" | "in_transit" | "delivered" | "completed";

describe("resolución de disputas (Postgres + Redis) — MOVO-337", () => {
  let app: FastifyInstance;
  let shipmentRepo: ShipmentRepository;
  let payments: FakePaymentsClient;
  const sendPush = vi.fn().mockResolvedValue(undefined);
  const sendAlert = vi.fn().mockResolvedValue(undefined);

  const senderId = randomUUID();
  const receiverId = randomUUID();
  const carrierId = randomUUID();
  const adminId = randomUUID();
  const adminName = "Lucía Admin";

  const baseInput: CreateShipmentInput = {
    senderId,
    receiverId,
    packageType: PackageType.standard_package,
    weightKg: 2.5,
    lengthCm: 30,
    widthCm: 20,
    heightCm: 15,
    description: "Caja con libros",
    pickupAddress: "Av. Colón 1234, Córdoba",
    pickupLat: -31.4201,
    pickupLng: -64.1888,
    deliveryAddress: "Bv. San Juan 500, Córdoba",
    deliveryLat: -31.4135,
    deliveryLng: -64.1811,
    ...FAR_WINDOW,
    suggestedPriceArs: 1000,
  };

  /**
   * Envío disputado con el estado de origen pedido: lo deja en `origin` (fixture que bypasea la máquina de estados)
   * y lo pasa a `disputed` por el camino real, así el evento trae el `fromStatus` que lee la resolución. Según la
   * columna de la matriz prepara el hold (`in_transit`), la liquidación acreditada (`delivered`/`completed`) o nada
   * (`assigned`: el barrido ya liberó el hold).
   */
  async function disputedShipment(origin: Origin, reason?: DisputeReason, cash = false) {
    const created = await shipmentRepo.create(baseInput);
    await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    await app.db.shipment.update({
      where: { id: created.id },
      data: {
        status: origin,
        carrierId,
        agreedPriceArs: AGREED_PRICE,
        ...(cash ? { paymentMethod: "cash" as const } : {}),
        lastStatusChangedAt: new Date(),
        ...(origin === "delivered" || origin === "completed" ? { deliveredAt: new Date() } : {}),
      },
    });
    await app.db.offer.create({
      data: {
        shipmentId: created.id,
        carrierId,
        priceOffered: AGREED_PRICE,
        offeredDate: FAR_WINDOW.pickupDate,
        status: OfferStatus.ACCEPTED,
        carrierNameAtOffer: "Juan P.",
      },
    });

    if (origin === "in_transit" && !cash) {
      await payments.createHold({
        shipmentId: created.id,
        carrierId,
        cardToken: "tok",
        amountArs: AGREED_PRICE,
        payerEmail: "emisor@example.com",
        payerUserId: senderId,
      });
    }
    if ((origin === "delivered" || origin === "completed") && !cash) {
      const now = new Date().toISOString();
      payments.settlements.set(created.id, {
        id: randomUUID(),
        shipmentId: created.id,
        holdId: randomUUID(),
        carrierId,
        mpPaymentId: "mp-1",
        status: "credited",
        kind: "delivery",
        grossAmountArs: AGREED_PRICE,
        mpFeeArs: 47.1,
        commissionArs: 150,
        debtOffsetArs: 0,
        debtSurchargeArs: 0,
        carrierGrossAmountArs: AGREED_PRICE,
        carrierMpFeeArs: 47.1,
        netAmountArs: 952.9,
        failureReason: null,
        capturedAt: now,
        createdAt: now,
        updatedAt: now,
      } satisfies SettlementResponse);
    }

    const disputeId = randomUUID();
    await shipmentRepo.updateStatus(created.id, ShipmentStatus.DISPUTED, null, "disputa", {
      expectedFrom: origin as ShipmentStatus,
      dispute: {
        id: disputeId,
        openedBy: reason === DisputeReason.PICKUP_NO_SHOW ? null : senderId,
        openedByRole: reason === DisputeReason.PICKUP_NO_SHOW ? null : "sender",
        reason: reason ?? DisputeReason.DAMAGED,
        description: "El paquete no llegó como esperaba",
      },
    });
    return { shipmentId: created.id, disputeId };
  }

  const resolve = (disputeId: string, payload: Record<string, unknown>) =>
    app.inject({
      method: "POST",
      url: `/internal/admin/disputes/${disputeId}/resolve`,
      payload: { reasoning: REASONING, adminId, adminName, ...payload },
    });

  const disputeRow = (id: string) => app.db.dispute.findUniqueOrThrow({ where: { id } });
  const shipmentRow = (id: string) => app.db.shipment.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    payments = createFakePaymentsClient();
    app = buildApp({
      usersClient: createFakeUsersClient({}),
      notificationsClient: { sendPush },
      paymentsClient: payments,
      alertNotifier: { send: sendAlert },
      sweepEnabled: false,
      orphanPhotoSweepEnabled: false,
      tripExpirySweepEnabled: false,
      transitAnomalySweepEnabled: false,
      pickupMissedSweepEnabled: false,
    });
    await app.ready();
    shipmentRepo = createShipmentRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments, shipments.trips RESTART IDENTITY CASCADE");
    sendPush.mockClear();
    sendAlert.mockClear();
    payments.holds.clear();
    payments.settlements.clear();
    payments.refunds.clear();
    payments.manualAdjustments.clear();
    payments.ledgerEntries.clear();
    payments.behavior.releaseError = null;
    payments.behavior.captureError = null;
    payments.behavior.refundError = null;
    payments.behavior.manualAdjustmentError = null;
    payments.behavior.nextHoldStatus = "authorized";
    payments.behavior.nextRefundStatus = "succeeded";
    vi.mocked(payments.releaseHold).mockClear();
    vi.mocked(payments.captureHold).mockClear();
    vi.mocked(payments.createRefund).mockClear();
    vi.mocked(payments.createManualAdjustment).mockClear();
    vi.mocked(payments.findHoldByShipment).mockClear();
    vi.mocked(payments.findSettlement).mockClear();
  });

  describe("matriz de resolución (AC5, AC8)", () => {
    // [origen, resultado, extra del body, acción, estado final, lo que conserva el transportista, lo que vuelve al emisor]
    const MATRIX: ReadonlyArray<
      readonly [Origin, DisputeOutcome, Record<string, unknown>, DisputePaymentAction, ShipmentStatus, number, number]
    > = [
      // `assigned`: el hold ya se liberó (no-retiro); lo que está en juego es el neto del transportista
      ["assigned", "sender", {}, "none", ShipmentStatus.CANCELLED, 0, NET_PRICE],
      ["assigned", "carrier", {}, "ledger_credit", ShipmentStatus.COMPLETED, NET_PRICE, 0],
      ["assigned", "partial", { percentage: 50 }, "ledger_credit", ShipmentStatus.COMPLETED, 500, 500],
      // `in_transit`: hold autorizado sin capturar
      ["in_transit", "sender", {}, "release_hold", ShipmentStatus.CANCELLED, 0, AGREED_PRICE],
      ["in_transit", "carrier", {}, "capture_hold", ShipmentStatus.COMPLETED, AGREED_PRICE, 0],
      ["in_transit", "partial", { percentage: 50 }, "capture_partial", ShipmentStatus.COMPLETED, 575, 575],
      // `delivered`/`completed`: el cobro ya está capturado
      ["delivered", "sender", {}, "refund_full", ShipmentStatus.CANCELLED, 0, AGREED_PRICE],
      ["delivered", "carrier", {}, "none", ShipmentStatus.COMPLETED, AGREED_PRICE, 0],
      ["delivered", "partial", { percentage: 25 }, "refund_partial", ShipmentStatus.COMPLETED, 287.5, 862.5],
      ["completed", "sender", {}, "refund_full", ShipmentStatus.CANCELLED, 0, AGREED_PRICE],
      ["completed", "carrier", {}, "none", ShipmentStatus.COMPLETED, AGREED_PRICE, 0],
      ["completed", "partial", { amountArs: 300 }, "refund_partial", ShipmentStatus.COMPLETED, 300, 850],
    ];

    it.each(MATRIX)(
      "%s + %s %j -> %s, el envío queda %s",
      async (origin, outcome, extra, action, finalStatus, carrierAmount, senderAmount) => {
        const { shipmentId, disputeId } = await disputedShipment(
          origin,
          origin === "assigned" ? DisputeReason.PICKUP_NO_SHOW : undefined,
        );

        const response = await resolve(disputeId, { outcome, ...extra });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({
          disputeId,
          shipmentId,
          outcome,
          reasoning: REASONING,
          carrierAmountArs: carrierAmount,
          senderAmountArs: senderAmount,
          paymentAction: action,
          status: "resolved",
          shipmentStatus: finalStatus,
          replayed: false,
        });

        // La disputa guarda resultado, monto, razonamiento, admin y fecha; el envío pasa a su estado final.
        const dispute = await disputeRow(disputeId);
        expect(dispute).toMatchObject({
          status: DisputeStatus.RESOLVED,
          outcome,
          reasoning: REASONING,
          resolvedBy: adminId,
          paymentAction: action,
        });
        expect(dispute.resolvedAt).not.toBeNull();
        expect(dispute.carrierAmountArs?.toNumber()).toBe(carrierAmount);
        expect(dispute.senderAmountArs?.toNumber()).toBe(senderAmount);
        expect((await shipmentRow(shipmentId)).status).toBe(finalStatus);
        const event = await app.db.shipmentEvent.findFirstOrThrow({
          where: { shipmentId, fromStatus: ShipmentStatus.DISPUTED },
        });
        expect(event).toMatchObject({ toStatus: finalStatus, actorId: adminId, actorName: adminName, kind: "manual" });

        // Y la acción de pago de la celda, una sola vez.
        expect(payments.releaseHold).toHaveBeenCalledTimes(action === "release_hold" ? 1 : 0);
        expect(payments.captureHold).toHaveBeenCalledTimes(action === "capture_hold" || action === "capture_partial" ? 1 : 0);
        expect(payments.createRefund).toHaveBeenCalledTimes(action === "refund_full" || action === "refund_partial" ? 1 : 0);
        expect(payments.createManualAdjustment).toHaveBeenCalledTimes(action === "ledger_credit" ? 1 : 0);
      },
    );

    describe("envío en efectivo (MOVO-37)", () => {
      // Sin hold ni liquidación de MP: nunca se le pega a MP y el monto en juego es el precio acordado.
      it.each([
        ["assigned", "sender", {}, 0, AGREED_PRICE],
        ["in_transit", "carrier", {}, AGREED_PRICE, 0],
        ["delivered", "partial", { percentage: 25 }, 287.5, 862.5],
        ["completed", "sender", {}, 0, AGREED_PRICE],
      ] as const)("%s + %s se resuelve sin movimiento de plata contra MP", async (origin, outcome, extra, carrierAmount, senderAmount) => {
        const { disputeId } = await disputedShipment(origin, origin === "assigned" ? DisputeReason.PICKUP_NO_SHOW : undefined, true);

        const response = await resolve(disputeId, { outcome, ...extra });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({
          paymentAction: "none",
          carrierAmountArs: carrierAmount,
          senderAmountArs: senderAmount,
          status: "resolved",
        });
        expect(payments.findHoldByShipment).not.toHaveBeenCalled();
        expect(payments.findSettlement).not.toHaveBeenCalled();
        expect(payments.releaseHold).not.toHaveBeenCalled();
        expect(payments.captureHold).not.toHaveBeenCalled();
        expect(payments.createRefund).not.toHaveBeenCalled();
      });

      it("a favor del emisor tras completarse: anula la comisión con un crédito, una sola vez", async () => {
        const { disputeId, shipmentId } = await disputedShipment("completed", undefined, true);
        await payments.registerCashCommission(shipmentId, { senderId, carrierId, agreedPriceArs: AGREED_PRICE });
        const commissionArs = payments.ledgerEntries.get(`cash_commission:${shipmentId}`)?.amountArs;

        await resolve(disputeId, { outcome: "sender" });
        await resolve(disputeId, { outcome: "sender" });

        expect(payments.createManualAdjustment).toHaveBeenCalledWith(
          carrierId,
          expect.objectContaining({ idempotencyKey: `dispute-${disputeId}-commission-reversal`, amountArs: -(commissionArs ?? 0), shipmentId }),
        );
      });

      it("desde delivered (sin comisión registrada) o con otro resultado no toca la cuenta corriente", async () => {
        const delivered = await disputedShipment("delivered", undefined, true);
        await resolve(delivered.disputeId, { outcome: "sender" });
        const completed = await disputedShipment("completed", undefined, true);
        await resolve(completed.disputeId, { outcome: "carrier" });

        expect(payments.createManualAdjustment).not.toHaveBeenCalled();
      });
    });

    it("captura parcial: manda el monto del transportista como captura de tipo penalidad", async () => {
      const { disputeId, shipmentId } = await disputedShipment("in_transit");
      await resolve(disputeId, { outcome: "partial", percentage: 50 });
      expect(payments.captureHold).toHaveBeenCalledWith(shipmentId, { kind: "dispute_partial", amountArs: 575 });
    });

    it("reembolso parcial: manda lo que vuelve al emisor, con la clave de la disputa", async () => {
      const { disputeId, shipmentId } = await disputedShipment("completed");
      await resolve(disputeId, { outcome: "partial", percentage: 25 });
      expect(payments.createRefund).toHaveBeenCalledWith(
        shipmentId,
        expect.objectContaining({ amountArs: 862.5, idempotencyKey: `dispute-${disputeId}`, adminId }),
      );
    });

    it("reembolso total: sin monto (lo reembolsable lo decide payments)", async () => {
      const { disputeId, shipmentId } = await disputedShipment("completed");
      await resolve(disputeId, { outcome: "sender" });
      const [, request] = vi.mocked(payments.createRefund).mock.calls[0]!;
      expect(vi.mocked(payments.createRefund).mock.calls[0]![0]).toBe(shipmentId);
      expect(request).not.toHaveProperty("amountArs");
    });

    it("no-retiro con resultado a favor del transportista: crédito negativo (a su favor) en la cuenta corriente, no captura", async () => {
      const { disputeId, shipmentId } = await disputedShipment("assigned", DisputeReason.PICKUP_NO_SHOW);
      await resolve(disputeId, { outcome: "carrier" });
      expect(payments.captureHold).not.toHaveBeenCalled();
      expect(payments.createManualAdjustment).toHaveBeenCalledWith(
        carrierId,
        expect.objectContaining({ amountArs: -NET_PRICE, idempotencyKey: `dispute-${disputeId}-credit`, shipmentId, adminId }),
      );
    });

    it("un reembolso que cae a la cuenta corriente del transportista resuelve igual, pero alerta: el emisor no cobró", async () => {
      payments.behavior.nextRefundStatus = "fallback_to_ledger";
      const { disputeId } = await disputedShipment("completed");

      const response = await resolve(disputeId, { outcome: "sender" });

      expect(response.statusCode).toBe(200);
      expect((await disputeRow(disputeId)).status).toBe(DisputeStatus.RESOLVED);
      expect(sendAlert).toHaveBeenCalledWith(expect.objectContaining({ kind: "dispute_refund_fallback_to_ledger" }));
    });
  });

  describe("idempotencia (DoD)", () => {
    it.each([
      ["in_transit", { outcome: "carrier" }, "captureHold"],
      ["in_transit", { outcome: "sender" }, "releaseHold"],
      ["completed", { outcome: "sender" }, "createRefund"],
      ["completed", { outcome: "partial", percentage: 75 }, "createRefund"],
      ["assigned", { outcome: "carrier" }, "createManualAdjustment"],
    ] as const)("%s %j: resolver dos veces no mueve plata dos veces (%s)", async (origin, body, method) => {
      const { disputeId, shipmentId } = await disputedShipment(
        origin,
        origin === "assigned" ? DisputeReason.PICKUP_NO_SHOW : undefined,
      );

      const first = await resolve(disputeId, body);
      const second = await resolve(disputeId, body);

      expect(first.statusCode).toBe(200);
      expect(first.json().replayed).toBe(false);
      expect(second.statusCode).toBe(200);
      expect(second.json()).toMatchObject({ disputeId, outcome: body.outcome, replayed: true });
      expect(payments[method]).toHaveBeenCalledTimes(1);
      expect(payments.refunds.size + payments.manualAdjustments.size).toBeLessThanOrEqual(1);
      // Un solo evento de salida de `disputed` y un solo juego de pushes.
      expect(await app.db.shipmentEvent.count({ where: { shipmentId, fromStatus: ShipmentStatus.DISPUTED } })).toBe(1);
      expect(sendPush).toHaveBeenCalledTimes(3);
    });

    it("dos pedidos a la vez: uno resuelve y el otro espera (409) o devuelve lo mismo; la plata se mueve una vez", async () => {
      const { disputeId } = await disputedShipment("completed");

      const [a, b] = await Promise.all([resolve(disputeId, { outcome: "sender" }), resolve(disputeId, { outcome: "sender" })]);

      expect([a.statusCode, b.statusCode].sort()).toSatisfy((codes: number[]) => codes[0] === 200 && [200, 409].includes(codes[1]!));
      expect(payments.createRefund).toHaveBeenCalledTimes(1);
    });

    it("otro resultado sobre una disputa ya resuelta es 409 DISPUTE_RESOLUTION_MISMATCH y no mueve nada", async () => {
      const { disputeId } = await disputedShipment("in_transit");
      await resolve(disputeId, { outcome: "carrier" });
      vi.mocked(payments.releaseHold).mockClear();

      const response = await resolve(disputeId, { outcome: "sender" });

      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("DISPUTE_RESOLUTION_MISMATCH");
      expect(payments.releaseHold).not.toHaveBeenCalled();
      expect((await disputeRow(disputeId)).outcome).toBe("carrier");
    });

    it("otro razonamiento sobre una disputa ya resuelta también es un conflicto", async () => {
      const { disputeId } = await disputedShipment("in_transit");
      await resolve(disputeId, { outcome: "carrier" });
      const response = await resolve(disputeId, { outcome: "carrier", reasoning: "Otro razonamiento distinto al anterior" });
      expect(response.statusCode).toBe(409);
    });
  });

  describe("falla de la acción de pago (AC7)", () => {
    it("la disputa NO queda resuelta: queda `resolving` con el resultado guardado, el envío sigue en disputa y hay alerta", async () => {
      payments.behavior.refundError = new ApiError(502, "PAYMENTS_SERVICE_UNAVAILABLE", "payments caído");
      const { disputeId, shipmentId } = await disputedShipment("completed");

      const response = await resolve(disputeId, { outcome: "sender" });

      expect(response.statusCode).toBe(502);
      expect(response.json().error.code).toBe("DISPUTE_PAYMENT_FAILED");
      const dispute = await disputeRow(disputeId);
      expect(dispute).toMatchObject({ status: DisputeStatus.RESOLVING, outcome: "sender", reasoning: REASONING });
      expect(dispute.resolvedAt).toBeNull();
      expect((await shipmentRow(shipmentId)).status).toBe(ShipmentStatus.DISPUTED);
      expect(sendAlert).toHaveBeenCalledWith(expect.objectContaining({ kind: "dispute_payment_failed" }));
      expect(sendPush).not.toHaveBeenCalled();
    });

    it("el estado intermedio se puede consultar y se reintenta con los mismos datos hasta resolver", async () => {
      payments.behavior.refundError = new ApiError(502, "PAYMENTS_SERVICE_UNAVAILABLE", "payments caído");
      const { disputeId, shipmentId } = await disputedShipment("completed");
      await resolve(disputeId, { outcome: "sender" });

      const detail = await app.inject({ method: "GET", url: `/internal/admin/disputes/${disputeId}` });
      expect(detail.json()).toMatchObject({
        status: "resolving",
        resolution: { outcome: "sender", reasoning: REASONING, resolvedAt: null },
      });

      payments.behavior.refundError = null;
      const retry = await resolve(disputeId, { outcome: "sender" });

      expect(retry.statusCode).toBe(200);
      expect(retry.json()).toMatchObject({ status: "resolved", replayed: false });
      expect((await shipmentRow(shipmentId)).status).toBe(ShipmentStatus.CANCELLED);
      expect(payments.refunds.size).toBe(1);
    });

    it("un reintento con otro resultado mientras está `resolving` es 409: el dinero ya pudo haberse movido", async () => {
      payments.behavior.refundError = new ApiError(502, "PAYMENTS_SERVICE_UNAVAILABLE", "payments caído");
      const { disputeId } = await disputedShipment("completed");
      await resolve(disputeId, { outcome: "sender" });

      const response = await resolve(disputeId, { outcome: "carrier" });

      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("DISPUTE_RESOLUTION_MISMATCH");
    });

    it("una captura que payments no acredita (sigue procesando) tampoco resuelve", async () => {
      const { disputeId } = await disputedShipment("in_transit");
      vi.mocked(payments.captureHold).mockResolvedValueOnce({ ...(await fakeSettlement()), status: "processing" });

      const response = await resolve(disputeId, { outcome: "carrier" });

      expect(response.statusCode).toBe(502);
      expect((await disputeRow(disputeId)).status).toBe(DisputeStatus.RESOLVING);
    });

    it("un rechazo de negocio de payments (antes de mover plata) devuelve la disputa a `open` y se relanza su código", async () => {
      payments.behavior.releaseError = new ApiError(409, "HOLD_NOT_RELEASABLE", "El hold ya no se puede liberar");
      const { disputeId, shipmentId } = await disputedShipment("in_transit");

      const response = await resolve(disputeId, { outcome: "sender" });

      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("HOLD_NOT_RELEASABLE");
      const dispute = await disputeRow(disputeId);
      expect(dispute).toMatchObject({ status: DisputeStatus.OPEN, outcome: null, reasoning: null });
      expect((await shipmentRow(shipmentId)).status).toBe(ShipmentStatus.DISPUTED);
    });

    async function fakeSettlement(): Promise<SettlementResponse> {
      const now = new Date().toISOString();
      return {
        id: randomUUID(),
        shipmentId: randomUUID(),
        holdId: randomUUID(),
        carrierId,
        mpPaymentId: "mp-1",
        status: "credited",
        kind: "delivery",
        grossAmountArs: AGREED_PRICE,
        mpFeeArs: null,
        commissionArs: 150,
        debtOffsetArs: 0,
        debtSurchargeArs: 0,
        carrierGrossAmountArs: AGREED_PRICE,
        carrierMpFeeArs: null,
        netAmountArs: null,
        failureReason: null,
        capturedAt: null,
        createdAt: now,
        updatedAt: now,
      };
    }
  });

  describe("validaciones", () => {
    it("`partial` sin porcentaje ni monto, o con los dos, es 400 DISPUTE_PARTIAL_INVALID", async () => {
      const { disputeId } = await disputedShipment("in_transit");
      for (const extra of [{}, { percentage: 50, amountArs: 500 }]) {
        const response = await resolve(disputeId, { outcome: "partial", ...extra });
        expect(response.statusCode).toBe(400);
        expect(response.json().error.code).toBe("DISPUTE_PARTIAL_INVALID");
      }
      expect((await disputeRow(disputeId)).status).toBe(DisputeStatus.OPEN);
    });

    it("un porcentaje fuera del set predefinido es 400 y un porcentaje en un resultado que no es parcial también", async () => {
      const { disputeId } = await disputedShipment("in_transit");
      expect((await resolve(disputeId, { outcome: "partial", percentage: 30 })).statusCode).toBe(400);
      const notPartial = await resolve(disputeId, { outcome: "carrier", percentage: 50 });
      expect(notPartial.statusCode).toBe(400);
      expect(notPartial.json().error.code).toBe("DISPUTE_PARTIAL_INVALID");
    });

    it("el razonamiento es obligatorio", async () => {
      const { disputeId } = await disputedShipment("in_transit");
      expect((await resolve(disputeId, { outcome: "carrier", reasoning: "corto" })).statusCode).toBe(400);
    });

    it("un monto libre que llega al total en juego es 422 con el máximo", async () => {
      const { disputeId } = await disputedShipment("completed");
      const response = await resolve(disputeId, { outcome: "partial", amountArs: AGREED_PRICE });
      expect(response.statusCode).toBe(422);
      expect(response.json().error).toMatchObject({ code: "DISPUTE_PARTIAL_ABOVE_MAXIMUM", details: { maximumArs: 1149.99 } });
    });

    it("una captura parcial por debajo de la comisión del hold es 422 con el mínimo y no guarda nada (AC6)", async () => {
      const { disputeId } = await disputedShipment("in_transit");

      const response = await resolve(disputeId, { outcome: "partial", amountArs: 100 });

      expect(response.statusCode).toBe(422);
      const { error } = response.json();
      expect(error.code).toBe("DISPUTE_PARTIAL_BELOW_MINIMUM");
      expect(error.details.minimumArs).toBeGreaterThan(149.5);
      expect(payments.captureHold).not.toHaveBeenCalled();
      expect((await disputeRow(disputeId)).status).toBe(DisputeStatus.OPEN);
    });

    it("in_transit sin hold autorizado es 422 HOLD_NOT_AUTHORIZED", async () => {
      const { disputeId, shipmentId } = await disputedShipment("in_transit");
      payments.holds.delete(shipmentId);
      const response = await resolve(disputeId, { outcome: "carrier" });
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe("HOLD_NOT_AUTHORIZED");
    });

    it("delivered sin cobro acreditado es 422 SETTLEMENT_NOT_REFUNDABLE", async () => {
      const { disputeId, shipmentId } = await disputedShipment("delivered");
      payments.settlements.delete(shipmentId);
      const response = await resolve(disputeId, { outcome: "sender" });
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe("SETTLEMENT_NOT_REFUNDABLE");
    });

    it("una disputa inexistente es 404", async () => {
      const response = await resolve(randomUUID(), { outcome: "carrier" });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe("DISPUTE_NOT_FOUND");
    });
  });

  describe("desbloqueo del transportista (AC9)", () => {
    it("mientras la disputa no esté resuelta lo bloquea; al resolverla, si no le queda otra abierta, se levanta", async () => {
      const first = await disputedShipment("in_transit");
      const second = await disputedShipment("in_transit");
      expect(await shipmentRepo.hasOpenDisputeAsCarrier(carrierId)).toBe(true);

      await resolve(first.disputeId, { outcome: "carrier" });
      expect(await shipmentRepo.hasOpenDisputeAsCarrier(carrierId)).toBe(true);

      await resolve(second.disputeId, { outcome: "carrier" });
      expect(await shipmentRepo.hasOpenDisputeAsCarrier(carrierId)).toBe(false);
    });

    it("una disputa `resolving` (plata sin mover) todavía lo bloquea", async () => {
      payments.behavior.refundError = new ApiError(502, "PAYMENTS_SERVICE_UNAVAILABLE", "payments caído");
      const { disputeId } = await disputedShipment("completed");
      await resolve(disputeId, { outcome: "sender" });
      expect(await shipmentRepo.hasOpenDisputeAsCarrier(carrierId)).toBe(true);
    });
  });

  describe("avisos a las partes (AC11)", () => {
    const pushTo = (userId: string) => sendPush.mock.calls.map(([call]) => call).find((call) => call.userId === userId);

    it("a favor del emisor: las tres partes reciben `dispute_resolved` con resultado y razonamiento, sin montos; califica el ganador", async () => {
      const { disputeId, shipmentId } = await disputedShipment("completed");

      await resolve(disputeId, { outcome: "sender" });

      expect(sendPush).toHaveBeenCalledTimes(3);
      expect(pushTo(senderId)).toMatchObject({
        category: "disputes",
        data: { type: "dispute_resolved", disputeId, shipmentId, outcome: "sender", result: "favorable", reasoning: REASONING, ratingPending: true },
      });
      expect(pushTo(carrierId)?.data).toMatchObject({ result: "unfavorable", ratingPending: false });
      expect(pushTo(receiverId)?.data).toMatchObject({ result: "neutral", ratingPending: false });
      for (const [push] of sendPush.mock.calls) {
        expect(`${push.title} ${push.body}`).not.toMatch(/\$|\d/);
        expect(JSON.stringify(push.data)).not.toMatch(/amountArs|1150|862/);
      }
    });

    it("parcial: califican las dos partes", async () => {
      const { disputeId } = await disputedShipment("completed");
      await resolve(disputeId, { outcome: "partial", percentage: 50 });
      expect(pushTo(senderId)?.data).toMatchObject({ result: "partial", ratingPending: true });
      expect(pushTo(carrierId)?.data).toMatchObject({ result: "partial", ratingPending: true });
      expect(pushTo(receiverId)?.data).toMatchObject({ ratingPending: false });
    });

    it("un push que falla no revierte la resolución", async () => {
      sendPush.mockRejectedValueOnce(new Error("push caído"));
      const { disputeId } = await disputedShipment("completed");
      const response = await resolve(disputeId, { outcome: "sender" });
      expect(response.statusCode).toBe(200);
      expect((await disputeRow(disputeId)).status).toBe(DisputeStatus.RESOLVED);
    });
  });

  describe("calificación de envíos no entregados (AC12)", () => {
    const rate = (shipmentId: string, raterId: string, rateeId: string) =>
      app.inject({
        method: "POST",
        url: `/shipments/${shipmentId}/ratings`,
        headers: { "x-user-id": raterId },
        payload: { rateeId, score: 4 },
      });

    it("a favor del emisor (envío cancelled): califica el emisor; el transportista, que perdió, no", async () => {
      const { disputeId, shipmentId } = await disputedShipment("completed");
      await resolve(disputeId, { outcome: "sender" });

      const loser = await rate(shipmentId, carrierId, senderId);
      expect(loser.statusCode).toBe(403);
      expect((await rate(shipmentId, senderId, carrierId)).statusCode).toBe(201);
    });

    it("a favor del transportista: califica el transportista; el emisor no", async () => {
      const { disputeId, shipmentId } = await disputedShipment("in_transit");
      await resolve(disputeId, { outcome: "carrier" });

      expect((await rate(shipmentId, senderId, carrierId)).statusCode).toBe(403);
      expect((await rate(shipmentId, carrierId, senderId)).statusCode).toBe(201);
    });

    it("parcial: califican las dos partes, el receptor no", async () => {
      const { disputeId, shipmentId } = await disputedShipment("in_transit");
      await resolve(disputeId, { outcome: "partial", percentage: 75 });

      expect((await rate(shipmentId, senderId, carrierId)).statusCode).toBe(201);
      expect((await rate(shipmentId, carrierId, senderId)).statusCode).toBe(201);
      expect((await rate(shipmentId, receiverId, carrierId)).statusCode).toBe(403);
    });

    it("con la disputa todavía abierta o `resolving` sigue sin poder calificarse", async () => {
      const { shipmentId } = await disputedShipment("completed");
      const response = await rate(shipmentId, senderId, carrierId);
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("SHIPMENT_RATING_DISPUTE_ACTIVE");
    });

    it("pasadas las 72 h desde la resolución, la ventana está cerrada", async () => {
      const { disputeId, shipmentId } = await disputedShipment("completed");
      await resolve(disputeId, { outcome: "sender" });
      await app.db.dispute.update({ where: { id: disputeId }, data: { resolvedAt: new Date(Date.now() - 73 * 60 * 60 * 1000) } });

      const response = await rate(shipmentId, senderId, carrierId);
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("SHIPMENT_RATING_WINDOW_EXPIRED");
    });

    describe("no-retiro atribuido (MOVO-270)", () => {
      /** Envío cancelado por el barrido de retiro no realizado, con la atribución indicada. */
      async function cancelledByNoShowSweep(attribution: "carrier" | "none") {
        const created = await shipmentRepo.create(baseInput);
        await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
        await shipmentRepo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
        await app.db.shipment.update({
          where: { id: created.id },
          data: { status: ShipmentStatus.ASSIGNED, carrierId, agreedPriceArs: AGREED_PRICE },
        });
        await shipmentRepo.updateStatus(created.id, ShipmentStatus.CANCELLED, null, "No se presentó", {
          expectedFrom: ShipmentStatus.ASSIGNED,
          pickupMiss: { attribution },
        });
        return created.id;
      }

      it("con atribución al transportista, solo el emisor lo califica", async () => {
        const shipmentId = await cancelledByNoShowSweep("carrier");

        expect((await rate(shipmentId, carrierId, senderId)).statusCode).toBe(403);
        expect((await rate(shipmentId, senderId, receiverId)).statusCode).toBe(403);
        expect((await rate(shipmentId, senderId, carrierId)).statusCode).toBe(201);
      });

      it("sin atribución (o cualquier otro cancelado) no se califica", async () => {
        const shipmentId = await cancelledByNoShowSweep("none");
        const response = await rate(shipmentId, senderId, carrierId);
        expect(response.statusCode).toBe(409);
        expect(response.json().error.code).toBe("SHIPMENT_NOT_DELIVERED");
      });
    });
  });

  describe("una disputa resuelta es definitiva", () => {
    it("un envío completed con su disputa resuelta no admite abrir otra, aunque siga dentro de los 7 días", async () => {
      const { disputeId, shipmentId } = await disputedShipment("completed");
      await resolve(disputeId, { outcome: "carrier" });

      const response = await app.inject({
        method: "POST",
        url: `/shipments/${shipmentId}/disputes`,
        headers: { "x-user-id": senderId },
        payload: { reason: DisputeReason.DAMAGED, description: "Sigo disconforme con el resultado" },
      });

      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe("DISPUTE_NOT_ALLOWED");
    });
  });

  describe("lectura para el panel", () => {
    it("el listado trae partes, motivo, apertura, estado al abrirse y conteos por estado; filtra por estado", async () => {
      const open = await disputedShipment("in_transit");
      const resolved = await disputedShipment("completed");
      await resolve(resolved.disputeId, { outcome: "carrier" });

      const all = await app.inject({ method: "GET", url: "/internal/admin/disputes" });
      expect(all.statusCode).toBe(200);
      const page = all.json();
      expect(page.statusCounts).toEqual({ open: 1, resolving: 0, resolved: 1 });
      expect(page.items).toHaveLength(2);
      expect(page.items.find((item: { id: string }) => item.id === open.disputeId)).toMatchObject({
        shipmentId: open.shipmentId,
        status: "open",
        reason: "damaged",
        shipmentStatusAtOpen: "in_transit",
        shipmentStatus: "disputed",
        sender: { id: senderId },
        carrier: { id: carrierId },
        receiver: { id: receiverId },
        outcome: null,
      });

      const onlyResolved = (await app.inject({ method: "GET", url: "/internal/admin/disputes?status=resolved" })).json();
      expect(onlyResolved.items.map((item: { id: string }) => item.id)).toEqual([resolved.disputeId]);
      expect(onlyResolved.items[0]).toMatchObject({ outcome: "carrier", shipmentStatusAtOpen: "completed", shipmentStatus: "completed" });
    });

    it("pagina por cursor, más reciente primero", async () => {
      const ids: string[] = [];
      for (let i = 0; i < 3; i += 1) ids.push((await disputedShipment("in_transit")).disputeId);

      const first = (await app.inject({ method: "GET", url: "/internal/admin/disputes?limit=2" })).json();
      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).not.toBeNull();
      const second = (await app.inject({ method: "GET", url: `/internal/admin/disputes?limit=2&cursor=${first.nextCursor}` })).json();
      expect(second.items).toHaveLength(1);
      expect(second.nextCursor).toBeNull();
      expect([...first.items, ...second.items].map((item: { id: string }) => item.id).sort()).toEqual([...ids].sort());
    });

    it("el expediente trae descripción, descargos y, resuelta, la resolución; las partes y el handshake/traza salen por su ruta", async () => {
      const { disputeId, shipmentId } = await disputedShipment("completed");
      await resolve(disputeId, { outcome: "partial", percentage: 50 });

      const detail = (await app.inject({ method: "GET", url: `/internal/admin/disputes/${disputeId}` })).json();
      expect(detail).toMatchObject({
        id: disputeId,
        description: "El paquete no llegó como esperaba",
        statements: [],
        resolution: { outcome: "partial", percentage: 50, carrierAmountArs: 575, senderAmountArs: 575, resolvedBy: adminId },
      });
      expect(detail.resolution.resolvedAt).not.toBeNull();

      const parties = (await app.inject({ method: "GET", url: `/internal/admin/disputes/${disputeId}/parties` })).json();
      expect(parties).toMatchObject({ shipmentId, senderId, carrierId, receiverId });
      expect((await app.inject({ method: "GET", url: `/internal/admin/disputes/${disputeId}/handshake` })).json()).toEqual([]);
      expect((await app.inject({ method: "GET", url: `/internal/admin/disputes/${disputeId}/trace` })).json()).toEqual({
        available: false,
        points: [],
      });
      expect((await app.inject({ method: "GET", url: `/internal/admin/disputes/${randomUUID()}` })).statusCode).toBe(404);
    });

    it("la vista previa muestra el monto en juego, la acción de cada resultado y el piso de la captura parcial", async () => {
      const { disputeId } = await disputedShipment("in_transit");

      const preview = (await app.inject({ method: "GET", url: `/internal/admin/disputes/${disputeId}/resolution-preview` })).json();

      expect(preview).toMatchObject({ statusAtOpen: "in_transit", stakeArs: AGREED_PRICE });
      expect(preview.minimumPartialArs).toBeGreaterThan(149.5);
      expect(preview.outcomes).toEqual([
        { outcome: "sender", paymentAction: "release_hold", shipmentStatus: "cancelled" },
        { outcome: "carrier", paymentAction: "capture_hold", shipmentStatus: "completed" },
        { outcome: "partial", paymentAction: "capture_partial", shipmentStatus: "completed" },
      ]);
      expect(preview.presets).toEqual([
        { percentage: 25, carrierAmountArs: 287.5, senderAmountArs: 862.5, belowMinimum: false },
        { percentage: 50, carrierAmountArs: 575, senderAmountArs: 575, belowMinimum: false },
        { percentage: 75, carrierAmountArs: 862.5, senderAmountArs: 287.5, belowMinimum: false },
      ]);
    });
  });
});
