import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FastifyInstance } from "fastify";
import {
  AdminChatPage,
  AdminShipmentDetail,
  AdminShipmentOffer,
  AdminShipmentPage,
  AdminShipmentTracking,
  HoldDetailResponse,
  ShipmentStatus,
} from "@movo/shared";
import { buildApp } from "../src/app";
import { createFakePaymentsClient, createFakeShipmentsClient, createFakeUsersClient } from "./fake-clients";

const sender = { id: randomUUID(), name: "Ana Emisora" };
const carrier = { id: randomUUID(), name: "Carlos Transportista" };
const receiver = { id: randomUUID(), name: "Rosa Receptora" };

const row = (overrides: Partial<AdminShipmentDetail> = {}): AdminShipmentDetail =>
  ({
    id: randomUUID(),
    code: "abcd1234",
    status: "in_transit",
    sender,
    carrier,
    receiver,
    pickupCity: "Córdoba",
    pickupAddress: "Av. Colón 1234",
    deliveryCity: "Villa María",
    deliveryAddress: "Bv. Sarmiento 10",
    pickupDate: "2030-01-01",
    pickupTimeWindowStart: "09:00",
    pickupTimeWindowEnd: "12:00",
    priceArs: 4500,
    priceKind: "agreed",
    lastStatusChangeAt: "2030-01-01T10:00:00.000Z",
    delayed: false,
    disputeId: null,
    fundingDeadline: null,
    redesignationDeadline: null,
    ...overrides,
  }) as AdminShipmentDetail;

const hold = { id: randomUUID(), status: "authorized", amountArs: 4500, wasAuthorized: true, cardBrand: "visa", cardLast4: "4242" } as unknown as HoldDetailResponse;

const card = (id: string, fullName: string) => ({
  id,
  fullName,
  photoUrl: null,
  accountStatus: "active" as const,
  identityVerified: true,
  licenseVerified: id === carrier.id,
  reputationScore: 4.8,
  ratingCount: 12,
});

describe("Envíos para el panel (MOVO-325)", () => {
  const admin = { "x-user-id": randomUUID(), "x-user-roles": "admin" };
  const detail = row();
  const page: AdminShipmentPage = {
    items: [detail],
    nextCursor: "cursor-2",
    counts: { all: 8, unassigned: 3, assigning: 1, in_progress: 3, closed: 12, disputes: 1 },
    statusCounts: {
      ...(Object.fromEntries(Object.values(ShipmentStatus).map((status) => [status, 0])) as AdminShipmentPage["statusCounts"]),
      published: 3,
      in_transit: 2,
    },
    alertCounts: { all: 2, unassigned: 0, assigning: 1, in_progress: 1, closed: 0, disputes: 0 },
  };
  const chat: AdminChatPage = {
    items: [{ id: randomUUID(), authorId: sender.id, authorName: "Ana", authorRole: "sender", body: "Hola", moderated: true, createdAt: "2030-01-01T10:00:00.000Z" }],
    nextCursor: null,
    partiesAccess: "read_only",
    archived: false,
    reports: [{ reporterId: receiver.id, reporterRole: "receiver", createdAt: "2030-01-01T11:00:00.000Z" }],
    events: [],
  };
  const tracking: AdminShipmentTracking = {
    shipmentId: detail.id,
    shipmentStatus: "in_transit",
    state: "live",
    reason: null,
    origin: { lat: -31.4201, lng: -64.1888, label: "Córdoba" },
    destination: { lat: -32.4075, lng: -63.2406, label: "Villa María" },
    plannedRoute: { polyline: "abc", distanceMeters: 140000, durationSeconds: 7200 },
    trace: [{ lat: -31.5, lng: -64.1, capturedAt: "2030-01-01T10:00:00.000Z" }],
    traceTruncated: false,
    traceAvailable: true,
    lastPosition: { lat: -31.6, lng: -64.0, accuracyM: null, capturedAt: "2030-01-01T10:01:00.000Z" },
    lastPingAt: "2030-01-01T10:01:01.000Z",
    signalLost: true,
    delayed: false,
    metrics: { avgSpeedKmh5m: null, remainingMeters: 110000, progressPct: 21.4, etaAt: null },
    serverTime: "2030-01-01T10:10:00.000Z",
    pollIntervalSeconds: 15,
  };
  const seen: { list?: string; chat?: string } = {};
  const offer: AdminShipmentOffer = {
    id: randomUUID(),
    carrierId: carrier.id,
    carrierName: carrier.name,
    carrierRatingAtOffer: 4.8,
    status: "accepted",
    priceArs: 4500,
    netArs: 3913.04,
    commissionArs: 586.96,
    commissionRate: 0.15,
    mpFeeEstimateArs: 224.55,
    receivedEstimateArs: 3688.49,
    offeredDate: "2030-01-01",
    pickupTimeWindowStart: null,
    pickupTimeWindowEnd: null,
    estimatedDeliveryDate: null,
    estimatedDeliveryTimeWindowStart: null,
    estimatedDeliveryTimeWindowEnd: null,
    message: "Paso temprano",
    tripId: null,
    createdAt: "2029-12-30T10:00:00.000Z",
    viewedAtBySender: "2029-12-30T10:30:00.000Z",
    respondedAt: "2029-12-30T12:00:00.000Z",
    expiresAt: null,
  };

  const build = (
    overrides: { usersDown?: boolean; paymentsDown?: boolean; shipmentsDown?: boolean; offersDown?: boolean; withHold?: boolean } = {},
  ) =>
    buildApp({
      shipmentsClient: createFakeShipmentsClient({
        page,
        details: { [detail.id]: detail },
        offers: { [detail.id]: [offer] },
        chats: { [detail.id]: chat },
        trackings: { [detail.id]: tracking },
        seen,
        down: overrides.shipmentsDown ?? false,
        offersDown: overrides.offersDown ?? false,
      }),
      usersClient: createFakeUsersClient({
        cards: [card(sender.id, sender.name), card(carrier.id, carrier.name), card(receiver.id, receiver.name)],
        down: overrides.usersDown ?? false,
      }),
      paymentsClient: createFakePaymentsClient({
        holds: overrides.withHold === false ? {} : { [detail.id]: hold },
        down: overrides.paymentsDown ?? false,
      }).client,
    });

  let app: FastifyInstance;
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    app = build();
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  const get = (url: string, headers: Record<string, string> = admin, instance: FastifyInstance = app) =>
    instance.inject({ method: "GET", url, headers });

  it("responde 403 sin rol admin en el listado, el detalle, el chat y el seguimiento", async () => {
    const notAdmin = { "x-user-id": randomUUID(), "x-user-roles": "sender" };
    for (const url of [
      "/admin/shipments",
      `/admin/shipments/${detail.id}`,
      `/admin/shipments/${detail.id}/chat/messages`,
      `/admin/shipments/${detail.id}/tracking`,
    ]) {
      expect((await get(url, notAdmin)).statusCode).toBe(403);
    }
  });

  it("lista los envíos con sus conteos y reenvía los filtros a svc-shipments", async () => {
    const res = await get("/admin/shipments?group=closed&city=C%C3%B3rdoba&q=ana&alert=true&limit=10&cursor=abc");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(page);
    const forwarded = new URLSearchParams(seen.list);
    expect(Object.fromEntries(forwarded)).toEqual({ group: "closed", city: "Córdoba", q: "ana", alert: "true", limit: "10", cursor: "abc" });
  });

  it("rechaza filtros inválidos con 400", async () => {
    expect((await get("/admin/shipments?group=otro")).statusCode).toBe(400);
    expect((await get("/admin/shipments?status=otro")).statusCode).toBe(400);
    expect((await get("/admin/shipments?limit=500")).statusCode).toBe(400);
    expect((await get("/admin/shipments?alert=quizas")).statusCode).toBe(400);
  });

  it("si svc-shipments no responde, el listado es 502", async () => {
    const down = build({ shipmentsDown: true });
    await down.ready();
    expect((await get("/admin/shipments", admin, down)).statusCode).toBe(502);
    await down.close();
  });

  it("arma el detalle con todos los bloques", async () => {
    const res = await get(`/admin/shipments/${detail.id}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.shipment.id).toBe(detail.id);
    expect(body.events).toEqual({ data: [], error: null });
    expect(body.photos).toEqual({ data: [], error: null });
    expect(body.offers).toEqual({ data: [offer], error: null });
    expect(body.payment.error).toBeNull();
    expect(body.payment.data.cardLast4).toBe("4242");
    expect(body.parties.data.map((p: { role: string }) => p.role)).toEqual(["sender", "carrier", "receiver"]);
    expect(body.parties.data[1]).toMatchObject({ id: carrier.id, licenseVerified: true, reputationScore: 4.8 });
  });

  it("si las ofertas no se pueden leer, el bloque viene en null con su causa y el resto se devuelve", async () => {
    const down = build({ offersDown: true });
    await down.ready();
    const res = await get(`/admin/shipments/${detail.id}`, admin, down);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.offers.data).toBeNull();
    expect(body.offers.error.code).toBe("SHIPMENTS_SERVICE_UNAVAILABLE");
    expect(body.events).toEqual({ data: [], error: null });
    await down.close();
  });

  it("un envío sin pago intentado trae el bloque de pago en null sin error", async () => {
    const noHold = build({ withHold: false });
    await noHold.ready();
    const body = (await get(`/admin/shipments/${detail.id}`, admin, noHold)).json();
    expect(body.payment).toEqual({ data: null, error: null });
    await noHold.close();
  });

  it("si svc-users no responde, las partes vienen en null con su causa y el resto se devuelve", async () => {
    const down = build({ usersDown: true });
    await down.ready();
    const res = await get(`/admin/shipments/${detail.id}`, admin, down);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.parties.data).toBeNull();
    expect(body.parties.error.code).toBe("USERS_SERVICE_UNAVAILABLE");
    expect(body.payment.data.cardLast4).toBe("4242");
    expect(body.shipment.id).toBe(detail.id);
    await down.close();
  });

  it("si svc-payments no responde, el pago viene en null con su causa y el resto se devuelve", async () => {
    const down = build({ paymentsDown: true });
    await down.ready();
    const body = (await get(`/admin/shipments/${detail.id}`, admin, down)).json();
    expect(body.payment.data).toBeNull();
    expect(body.payment.error.code).toBe("PAYMENTS_SERVICE_UNAVAILABLE");
    expect(body.parties.data).toHaveLength(3);
    await down.close();
  });

  it("un envío inexistente es 404", async () => {
    expect((await get(`/admin/shipments/${randomUUID()}`)).statusCode).toBe(404);
    expect((await get(`/admin/shipments/${randomUUID()}/chat/messages`)).statusCode).toBe(404);
    expect((await get(`/admin/shipments/${randomUUID()}/tracking`)).statusCode).toBe(404);
  });

  it("devuelve el seguimiento tal cual, con los `null` intactos y sin cache (MOVO-327)", async () => {
    const res = await get(`/admin/shipments/${detail.id}/tracking`);
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.json()).toEqual(tracking);
  });

  it("si svc-shipments no responde, el seguimiento es 502", async () => {
    const down = build({ shipmentsDown: true });
    await down.ready();
    expect((await get(`/admin/shipments/${detail.id}/tracking`, admin, down)).statusCode).toBe(502);
    await down.close();
  });

  it("devuelve el chat con el reporte, el rol del autor y si las partes pueden escribir", async () => {
    const res = await get(`/admin/shipments/${detail.id}/chat/messages?limit=20`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(chat);
    expect(seen.chat).toBe("limit=20");
  });

  it("las lecturas no escriben en la bitácora", async () => {
    const adminId = randomUUID();
    await get(`/admin/shipments`, { "x-user-id": adminId, "x-user-roles": "admin" });
    await get(`/admin/shipments/${detail.id}`, { "x-user-id": adminId, "x-user-roles": "admin" });
    await get(`/admin/shipments/${detail.id}/tracking`, { "x-user-id": adminId, "x-user-roles": "admin" });
    expect(await app.db.auditLog.count({ where: { adminId } })).toBe(0);
  });
});
