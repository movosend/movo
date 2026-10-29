import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import {
  AdminDisputeCounts,
  AdminDisputeDetail,
  AdminDisputePage,
  AdminShipmentDetail,
  AdminShipmentPage,
  DisputePartyRole,
  DisputeReason,
  DisputeStatus,
  ShipmentStatus,
} from "@movo/shared";
import { buildApp } from "../src/app";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { CreateShipmentInput, PackageType } from "../src/models/shipment";
import { createFakeUsersClient } from "./fake-users-client";

/**
 * MOVO-341: lecturas de disputas para el panel (`/internal/admin/disputes*`): filtro `city`, orden, ciudad en la fila,
 * contadores, historial de cada parte y atribución de las disputas de sistema (DD-052); y la disputa en el envío
 * (`disputeId` + resumen). Postgres y Redis reales.
 */

const DAY = 24 * 60 * 60 * 1000;

describe("lectura de disputas para el panel (Postgres + Redis) — MOVO-341", () => {
  let app: FastifyInstance;
  let shipmentRepo: ShipmentRepository;

  const carrierId = randomUUID();

  const baseInput = (senderId: string): CreateShipmentInput => ({
    senderId,
    receiverId: randomUUID(),
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
    pickupDate: new Date("2031-06-01T00:00:00.000Z"),
    pickupTimeWindowStart: new Date("1970-01-01T14:00:00.000Z"),
    pickupTimeWindowEnd: new Date("1970-01-01T18:00:00.000Z"),
    suggestedPriceArs: 1000,
  });

  /** Envío `in_transit` con transportista, pasado a `disputed` por el camino real. */
  async function disputedShipment(
    opts: { senderId?: string; city?: string | null; reason?: DisputeReason; system?: boolean; openedDaysAgo?: number } = {},
  ) {
    const senderId = opts.senderId ?? randomUUID();
    const created = await shipmentRepo.create(baseInput(senderId));
    await app.db.shipment.update({
      where: { id: created.id },
      data: {
        status: ShipmentStatus.IN_TRANSIT,
        carrierId,
        lastStatusChangedAt: new Date(),
        pickupCity: opts.city === undefined ? "Córdoba" : opts.city,
      },
    });
    const system = opts.system ?? false;
    const disputeId = randomUUID();
    await shipmentRepo.updateStatus(created.id, ShipmentStatus.DISPUTED, null, "disputa", {
      expectedFrom: ShipmentStatus.IN_TRANSIT,
      dispute: {
        id: disputeId,
        openedBy: system ? null : senderId,
        openedByRole: system ? null : ("sender" as DisputePartyRole),
        reason: opts.reason ?? DisputeReason.DAMAGED,
        description: system ? "La entrega no se confirmó dentro del plazo" : "El paquete llegó roto",
      },
    });
    if (opts.openedDaysAgo !== undefined) {
      await app.db.dispute.update({ where: { id: disputeId }, data: { openedAt: new Date(Date.now() - opts.openedDaysAgo * DAY) } });
    }
    return { shipmentId: created.id, disputeId, senderId, receiverId: created.receiverId };
  }

  const get = <T>(url: string) => app.inject({ method: "GET", url }).then((response) => ({ status: response.statusCode, body: response.json() as T }));

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    app = buildApp({
      usersClient: createFakeUsersClient({}),
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
  });

  describe("GET /internal/admin/disputes", () => {
    it("filtra por ciudad del retiro (parcial, sin tildes ni mayúsculas), la trae en la fila y los conteos respetan el filtro", async () => {
      const cordoba = await disputedShipment({ city: "Córdoba" });
      await disputedShipment({ city: "Villa Carlos Paz" });
      await disputedShipment({ city: "Rosario" });
      await disputedShipment({ city: null });

      const { status, body } = await get<AdminDisputePage>("/internal/admin/disputes?city=CORDOBA");

      expect(status).toBe(200);
      expect(body.items.map((item) => item.id)).toEqual([cordoba.disputeId]);
      expect(body.items[0]?.pickupCity).toBe("Córdoba");
      expect(body.statusCounts).toEqual({ open: 1, resolving: 0, resolved: 0 });

      const partial = await get<AdminDisputePage>("/internal/admin/disputes?city=carlos");
      expect(partial.body.items).toHaveLength(1);
      expect(partial.body.items[0]?.pickupCity).toBe("Villa Carlos Paz");
      // La fila sin ciudad tampoco aparece sin filtro de ciudad con pickupCity null: se informa como null.
      const all = await get<AdminDisputePage>("/internal/admin/disputes");
      expect(all.body.items.map((item) => item.pickupCity).sort()).toEqual(["Córdoba", "Rosario", "Villa Carlos Paz", null].sort());
    });

    it("un % o un _ en la ciudad no actúan como comodín", async () => {
      await disputedShipment({ city: "Córdoba" });
      const { body } = await get<AdminDisputePage>(`/internal/admin/disputes?city=${encodeURIComponent("%")}`);
      expect(body.items).toHaveLength(0);
    });

    it("ordena por apertura: más reciente primero por defecto y sort=oldest pone primero la más antigua, con cursor", async () => {
      const oldest = await disputedShipment({ openedDaysAgo: 9 });
      const middle = await disputedShipment({ openedDaysAgo: 4 });
      const newest = await disputedShipment({ openedDaysAgo: 1 });

      const byDefault = await get<AdminDisputePage>("/internal/admin/disputes");
      expect(byDefault.body.items.map((item) => item.id)).toEqual([newest.disputeId, middle.disputeId, oldest.disputeId]);

      const first = await get<AdminDisputePage>("/internal/admin/disputes?sort=oldest&limit=2");
      expect(first.body.items.map((item) => item.id)).toEqual([oldest.disputeId, middle.disputeId]);
      expect(first.body.nextCursor).toBe(middle.disputeId);

      const second = await get<AdminDisputePage>(`/internal/admin/disputes?sort=oldest&limit=2&cursor=${first.body.nextCursor}`);
      expect(second.body.items.map((item) => item.id)).toEqual([newest.disputeId]);
      expect(second.body.nextCursor).toBeNull();

      expect((await get("/internal/admin/disputes?sort=random")).status).toBe(400);
    });
  });

  describe("GET /internal/admin/disputes/counts", () => {
    it("cuenta abiertas, en resolución y abiertas hace más de 3 y 7 días; las resueltas no cuentan", async () => {
      await disputedShipment({ openedDaysAgo: 1 });
      await disputedShipment({ openedDaysAgo: 5 });
      await disputedShipment({ openedDaysAgo: 10 });
      const resolving = await disputedShipment({ openedDaysAgo: 12 });
      const resolved = await disputedShipment({ openedDaysAgo: 20 });
      await app.db.dispute.update({ where: { id: resolving.disputeId }, data: { status: DisputeStatus.RESOLVING } });
      await app.db.dispute.update({ where: { id: resolved.disputeId }, data: { status: DisputeStatus.RESOLVED } });

      const { status, body } = await get<AdminDisputeCounts>("/internal/admin/disputes/counts");

      expect(status).toBe(200);
      expect(body).toEqual({ open: 3, resolving: 1, openOlderThan3Days: 2, openOlderThan7Days: 1 });
    });

    it("sin disputas devuelve ceros", async () => {
      expect((await get<AdminDisputeCounts>("/internal/admin/disputes/counts")).body).toEqual({
        open: 0,
        resolving: 0,
        openOlderThan3Days: 0,
        openOlderThan7Days: 0,
      });
    });
  });

  describe("GET /internal/admin/disputes/:id", () => {
    it("trae el historial de cada parte: cuántas abrió, perdió y tiene abiertas", async () => {
      const senderId = randomUUID();
      const lost = await disputedShipment({ senderId });
      const partial = await disputedShipment({ senderId });
      const current = await disputedShipment({ senderId });
      // Una resuelta a favor del transportista (la perdió el emisor) y una parcial (no cuenta como perdida).
      await app.db.dispute.update({ where: { id: lost.disputeId }, data: { status: DisputeStatus.RESOLVED, outcome: "carrier" } });
      await app.db.dispute.update({ where: { id: partial.disputeId }, data: { status: DisputeStatus.RESOLVED, outcome: "partial" } });

      const { status, body } = await get<AdminDisputeDetail>(`/internal/admin/disputes/${current.disputeId}`);

      expect(status).toBe(200);
      expect(body.pickupCity).toBe("Córdoba");
      const bySender = body.partyHistory.find((entry) => entry.role === "sender");
      expect(bySender).toEqual({ userId: senderId, role: "sender", opened: 3, lost: 1, open: 1 });
      // El transportista participa en las tres: perdió la que ganó el emisor (ninguna), y tiene una abierta.
      const byCarrier = body.partyHistory.find((entry) => entry.role === "carrier");
      expect(byCarrier).toEqual({ userId: carrierId, role: "carrier", opened: 0, lost: 0, open: 1 });
      const byReceiver = body.partyHistory.find((entry) => entry.role === "receiver");
      expect(byReceiver).toMatchObject({ role: "receiver", opened: 0, lost: 0, open: 1 });
      expect(body.attribution).toBeNull();
    });

    it("una disputa del transportista perdida cuenta contra él cuando gana el emisor", async () => {
      const resolved = await disputedShipment();
      const current = await disputedShipment();
      await app.db.dispute.update({ where: { id: resolved.disputeId }, data: { status: DisputeStatus.RESOLVED, outcome: "sender" } });

      const { body } = await get<AdminDisputeDetail>(`/internal/admin/disputes/${current.disputeId}`);

      expect(body.partyHistory.find((entry) => entry.role === "carrier")).toMatchObject({ lost: 1, open: 1 });
    });

    it("pickup_no_show: atribuye al transportista con la llegada registrada y los conteos del barrido", async () => {
      const system = await disputedShipment({ system: true, reason: DisputeReason.PICKUP_NO_SHOW });
      const arrivedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
      await app.db.pickupEvidence.create({
        data: {
          shipmentId: system.shipmentId,
          carrierId,
          arrivedAt,
          arrivedLat: -31.4202,
          arrivedLng: -64.1889,
          arrivedAccuracyM: 12.5,
          farPositionsInWindow: 0,
          grayPositionsInWindow: 2,
        },
      });

      const { body } = await get<AdminDisputeDetail>(`/internal/admin/disputes/${system.disputeId}`);

      expect(body.openedByRole).toBeNull();
      expect(body.attribution).toMatchObject({
        reason: "pickup_no_show",
        attributedTo: "carrier",
        summary: "La entrega no se confirmó dentro del plazo",
        farPositionsInWindow: 0,
        grayPositionsInWindow: 2,
        positions: [{ lat: -31.4202, lng: -64.1889, accuracyM: 12.5, capturedAt: arrivedAt.toISOString(), class: "arrival" }],
      });
      expect(body.attribution?.sweptAt).toBeTruthy();
      expect(body.attribution?.lastPingAt).toBeTruthy();
    });

    it("pickup_no_show sin evidencia guardada: sin posiciones y sin último ping", async () => {
      const system = await disputedShipment({ system: true, reason: DisputeReason.PICKUP_NO_SHOW });

      const { body } = await get<AdminDisputeDetail>(`/internal/admin/disputes/${system.disputeId}`);

      expect(body.attribution).toMatchObject({ positions: [], lastPingAt: null, farPositionsInWindow: 0, grayPositionsInWindow: 0 });
    });

    it("transit_anomaly: trae la atribución con el último ping de la traza con custodia", async () => {
      const system = await disputedShipment({ system: true, reason: DisputeReason.TRANSIT_ANOMALY });

      const { body } = await get<AdminDisputeDetail>(`/internal/admin/disputes/${system.disputeId}`);

      expect(body.attribution).toMatchObject({ reason: "transit_anomaly", attributedTo: "carrier", positions: [] });
    });

    it("una disputa inexistente es 404", async () => {
      expect((await get(`/internal/admin/disputes/${randomUUID()}`)).status).toBe(404);
    });
  });

  describe("la disputa en el envío", () => {
    it("el detalle del envío trae disputeId y el resumen con los descargos, y el listado el disputeId", async () => {
      const disputed = await disputedShipment();
      await app.db.disputeStatement.create({
        data: { disputeId: disputed.disputeId, authorId: carrierId, authorRole: "carrier", kind: "statement", text: "Lo entregué bien" },
      });
      const undisputed = await shipmentRepo.create(baseInput(randomUUID()));

      const detail = await get<AdminShipmentDetail>(`/internal/admin/shipments/${disputed.shipmentId}`);
      expect(detail.body.disputeId).toBe(disputed.disputeId);
      expect(detail.body.dispute).toMatchObject({
        id: disputed.disputeId,
        status: "open",
        reason: "damaged",
        openedByRole: "sender",
        statementsCount: 1,
      });

      const plain = await get<AdminShipmentDetail>(`/internal/admin/shipments/${undisputed.id}`);
      expect(plain.body.disputeId).toBeNull();
      expect(plain.body.dispute).toBeNull();

      const list = await get<AdminShipmentPage>("/internal/admin/shipments?status=disputed");
      expect(list.body.items.find((item) => item.id === disputed.shipmentId)?.disputeId).toBe(disputed.disputeId);
    });
  });
});
