import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FastifyInstance } from "fastify";
import { DisputeReason, ShipmentStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { PackageType } from "../src/models/shipment";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { createFakeUsersClient } from "./fake-users-client";
import { createFakePaymentsClient } from "./fake-payments-client";
import { createFakePricingClient } from "./fake-pricing-client";
import { createFakePricingLogisticsClient } from "./fake-pricing-logistics-client";

const HOUR_MS = 60 * 60 * 1000;
const hoursAgo = (hours: number) => new Date(Date.now() - hours * HOUR_MS);

/** MOVO-342: bandejas de la home del panel y objetivos de la bitácora, contra Postgres real con fechas fijas. */
describe("home del panel (Postgres) — MOVO-342", () => {
  let app: FastifyInstance;
  let shipments: ShipmentRepository;

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    app = buildApp({
      usersClient: createFakeUsersClient({}),
      paymentsClient: createFakePaymentsClient(),
      pricingClient: createFakePricingClient(),
      pricingLogisticsClient: createFakePricingLogisticsClient(),
      sweepEnabled: false,
      orphanPhotoSweepEnabled: false,
      tripExpirySweepEnabled: false,
      transitAnomalySweepEnabled: false,
      pickupMissedSweepEnabled: false,
    });
    await app.ready();
    shipments = createShipmentRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments RESTART IDENTITY CASCADE");
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.support_conversations RESTART IDENTITY CASCADE");
  });

  const get = async (path: string) => {
    const response = await app.inject({ method: "GET", url: `/internal/admin/overview/${path}` });
    expect(response.statusCode).toBe(200);
    return response.json();
  };

  async function shipmentIn(status: ShipmentStatus, data: Record<string, unknown> = {}) {
    const created = await shipments.create({
      senderId: randomUUID(),
      receiverId: randomUUID(),
      packageType: PackageType.standard_package,
      weightKg: 1,
      lengthCm: 10,
      widthCm: 10,
      heightCm: 10,
      description: "Caja",
      pickupAddress: "Av. Colón 1234, Córdoba",
      pickupLat: -31.42,
      pickupLng: -64.18,
      deliveryAddress: "Bv. San Juan 500, Córdoba",
      deliveryLat: -31.41,
      deliveryLng: -64.18,
      pickupDate: new Date("2031-06-01T00:00:00.000Z"),
      pickupTimeWindowStart: new Date("1970-01-01T14:00:00.000Z"),
      pickupTimeWindowEnd: new Date("1970-01-01T18:00:00.000Z"),
      suggestedPriceArs: 1000,
    });
    await app.db.shipment.update({ where: { id: created.id }, data: { status, ...data } });
    return created.id;
  }

  async function dispute(reason: DisputeReason, openedAt: Date, data: Record<string, unknown> = {}) {
    const shipmentId = await shipmentIn(ShipmentStatus.DISPUTED);
    const row = await app.db.dispute.create({
      data: { shipmentId, reason, description: "x", openedAt, ...data },
    });
    return { id: row.id, shipmentId };
  }

  describe("disputas", () => {
    it("vacía, todo en cero", async () => {
      expect(await get("disputes")).toEqual({ count: 0, awaitingPayment: 0, oldestAt: null, yesterdayCount: 0, breakdown: [] });
    });

    it("cuenta las abiertas, separa las que esperan el pago, reconstruye ayer y desglosa por motivo", async () => {
      await dispute(DisputeReason.DAMAGED, hoursAgo(100));
      await dispute(DisputeReason.DAMAGED, hoursAgo(2));
      await dispute(DisputeReason.TRANSIT_ANOMALY, hoursAgo(30));
      await dispute(DisputeReason.DAMAGED, hoursAgo(50), { status: "resolving" });
      // Abierta ayer a esta hora, resuelta hoy: cuenta para ayer, no para hoy.
      await dispute(DisputeReason.DAMAGED, hoursAgo(48), { status: "resolved", resolvedAt: hoursAgo(1) });
      // Resuelta antes de ayer a esta hora: no cuenta para ninguno.
      await dispute(DisputeReason.DAMAGED, hoursAgo(200), { status: "resolved", resolvedAt: hoursAgo(90) });

      const body = await get("disputes");

      expect(body).toMatchObject({ count: 3, awaitingPayment: 1, yesterdayCount: 4 });
      expect(body.breakdown).toEqual([
        { key: DisputeReason.DAMAGED, count: 2 },
        { key: DisputeReason.TRANSIT_ANOMALY, count: 1 },
      ]);
      // La más vieja de las abiertas, no la `resolving` ni la resuelta.
      expect(Math.round((Date.now() - new Date(body.oldestAt).getTime()) / HOUR_MS)).toBe(100);
    });

    it("el total coincide con el contador `open` de MOVO-341", async () => {
      await dispute(DisputeReason.DAMAGED, hoursAgo(5));
      await dispute(DisputeReason.DAMAGED, hoursAgo(80));
      const counts = (await app.inject({ method: "GET", url: "/internal/admin/disputes/counts" })).json();
      expect((await get("disputes")).count).toBe(counts.open);
    });
  });

  describe("soporte", () => {
    const conversation = (data: Record<string, unknown>) =>
      app.db.supportConversation.create({ data: { userId: randomUUID(), topic: "payments", ...data } as never });

    it("solo cuenta las que esperan al equipo y mide la espera desde el último mensaje del usuario", async () => {
      await conversation({ lastUserMessageAt: hoursAgo(3), priority: "urgent" });
      await conversation({ lastUserMessageAt: hoursAgo(1), topic: "account" });
      await conversation({ lastUserMessageAt: hoursAgo(9), status: "awaiting_user" });
      await conversation({ lastUserMessageAt: hoursAgo(50), status: "resolved" });

      const body = await get("support");

      expect(body).toMatchObject({ count: 2, urgent: 1, yesterdayCount: null });
      expect(body.breakdown).toEqual([
        { key: "account", count: 1 },
        { key: "payments", count: 1 },
      ]);
      expect(Math.round((Date.now() - new Date(body.oldestAt).getTime()) / HOUR_MS)).toBe(3);
    });
  });

  describe("envíos en alerta", () => {
    it("sigue la regla del listado: coincide con `alertCounts.all` y separa los demorados", async () => {
      await shipmentIn(ShipmentStatus.IN_TRANSIT, { transitAnomalyFlaggedAt: hoursAgo(6) });
      await shipmentIn(ShipmentStatus.IN_TRANSIT);
      await shipmentIn(ShipmentStatus.ASSIGNED_UNFUNDED, { lastStatusChangedAt: hoursAgo(2) });
      await shipmentIn(ShipmentStatus.ASSIGNED_UNFUNDED, { lastStatusChangedAt: hoursAgo(1) });
      await shipmentIn(ShipmentStatus.PUBLISHED);

      const body = await get("shipment-alerts");

      expect(body).toMatchObject({ count: 3, inTransit: 1, yesterdayCount: null });
      expect(body.breakdown).toEqual([
        { key: ShipmentStatus.ASSIGNED_UNFUNDED, count: 2 },
        { key: "delayed", count: 1 },
      ]);
      expect(Math.round((Date.now() - new Date(body.oldestAt).getTime()) / HOUR_MS)).toBe(6);

      const listed = (await app.inject({ method: "GET", url: "/internal/admin/shipments?limit=1" })).json();
      expect(body.count).toBe(listed.alertCounts.all);
    });
  });

  describe("mensajes señalados", () => {
    async function message(shipmentId: string, createdAt: Date, moderated = true) {
      await app.db.chatMessage.create({
        data: { shipmentId, authorId: randomUUID(), body: "***", clientMessageId: randomUUID(), moderated, createdAt },
      });
    }

    it("mira la ventana de 7 días, suma mensajes moderados y reportes de chat, y reconstruye ayer", async () => {
      const shipmentId = await shipmentIn(ShipmentStatus.IN_TRANSIT);
      await message(shipmentId, hoursAgo(1));
      await message(shipmentId, hoursAgo(30));
      await message(shipmentId, hoursAgo(1), false);
      await message(shipmentId, hoursAgo(24 * 7.5));
      await message(shipmentId, hoursAgo(24 * 9));
      await app.db.chatReport.create({ data: { shipmentId, reporterId: randomUUID(), createdAt: hoursAgo(5) } });

      const body = await get("flagged-messages");

      expect(body.count).toBe(3);
      expect(body.breakdown).toEqual([
        { key: "moderated", count: 2 },
        { key: "chat_report", count: 1 },
      ]);
      // Ayer a esta hora: la ventana iba de hace 8 días a hace 1 día. Entran el de 30 h y el de 7,5 días.
      expect(body.yesterdayCount).toBe(2);
      expect(Math.round((Date.now() - new Date(body.oldestAt).getTime()) / HOUR_MS)).toBe(30);
    });

    it("vacía, sin desglose", async () => {
      expect(await get("flagged-messages")).toEqual({ count: 0, oldestAt: null, yesterdayCount: 0, breakdown: [] });
    });
  });

  describe("objetivos de la bitácora", () => {
    it("resuelve disputa y reporte de chat al envío, y la consulta a su código; un id inexistente no vuelve", async () => {
      const opened = await dispute(DisputeReason.DAMAGED, hoursAgo(1));
      const report = await app.db.chatReport.create({ data: { shipmentId: opened.shipmentId, reporterId: randomUUID() } });
      const conversation = await app.db.supportConversation.create({ data: { userId: randomUUID(), topic: "payments" } });
      const missing = randomUUID();

      const response = await app.inject({
        method: "POST",
        url: "/internal/admin/audit-targets",
        payload: { disputes: [opened.id, missing], chatReports: [report.id], supportConversations: [conversation.id] },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        disputes: { [opened.id]: { shipmentId: opened.shipmentId } },
        chatReports: { [report.id]: { shipmentId: opened.shipmentId } },
        supportConversations: { [conversation.id]: { code: expect.stringMatching(/^SOP-\d+$/) } },
      });
    });
  });
});
