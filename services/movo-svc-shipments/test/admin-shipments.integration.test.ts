import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import {
  AdminChatPage,
  AdminShipmentDetail,
  AdminShipmentOffer,
  AdminShipmentPage,
  ACTIVE_SHIPMENT_STATUSES,
  isAdminShipmentAlert,
  ShipmentStatus,
} from "@movo/shared";
import { buildApp } from "../src/app";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { CreateShipmentInput, PackageType } from "../src/models/shipment";
import { createFakeUsersClient, fakePublicProfile } from "./fake-users-client";
import { createMockStorageProvider } from "../src/adapters/mock-storage-provider";

/**
 * MOVO-325: listado, detalle, eventos, fotos y chat de los envíos para el panel. Contra Postgres y
 * Redis reales. Cada test marca sus envíos con una `tag` aleatoria en la dirección y busca por ella,
 * así no depende de lo que ya haya en la base.
 */
describe("Envíos para el panel (Postgres) — MOVO-325", () => {
  let app: FastifyInstance;
  let repo: ShipmentRepository;
  const lookups: string[] = [];

  function baseInput(tag: string, overrides: Partial<CreateShipmentInput> = {}): CreateShipmentInput {
    return {
      senderId: randomUUID(),
      receiverId: randomUUID(),
      packageType: PackageType.standard_package,
      weightKg: 2.5,
      lengthCm: 30,
      widthCm: 20,
      heightCm: 15,
      description: "Caja",
      pickupAddress: `Av. Colón 1234 ${tag}`,
      pickupLat: -31.4201,
      pickupLng: -64.1888,
      pickupCity: "Córdoba",
      deliveryAddress: `Bv. San Juan 500 ${tag}`,
      deliveryLat: -32.4075,
      deliveryLng: -63.2406,
      deliveryCity: "Villa María",
      pickupDate: new Date("2030-01-01T00:00:00.000Z"),
      pickupTimeWindowStart: new Date("1970-01-01T09:00:00.000Z"),
      pickupTimeWindowEnd: new Date("1970-01-01T12:00:00.000Z"),
      suggestedPriceArs: 4500,
      calculationMethod: null,
      highDemand: null,
      ...overrides,
    };
  }

  /** Crea un envío y lo deja en `status` directo en la base (no es el flujo real), con el cambio de estado a `at`. */
  async function seed(
    tag: string,
    status: ShipmentStatus,
    extra: { at?: Date; carrierId?: string | null; names?: boolean; input?: Partial<CreateShipmentInput>; data?: Record<string, unknown> } = {},
  ) {
    const input = baseInput(tag, extra.input);
    const created = await repo.create(input);
    await app.db.shipment.update({
      where: { id: created.id },
      data: {
        status,
        carrierId: extra.carrierId ?? null,
        lastStatusChangedAt: extra.at ?? new Date(),
        ...extra.data,
      },
    });
    if (extra.names !== false) {
      await repo.recordDisplayNames([
        { userId: input.senderId, name: `Emisor ${tag}` },
        { userId: input.receiverId, name: `Receptor ${tag}` },
        ...(extra.carrierId ? [{ userId: extra.carrierId, name: `Transportista ${tag}` }] : []),
      ]);
    }
    return { id: created.id, senderId: input.senderId, receiverId: input.receiverId, carrierId: extra.carrierId ?? null };
  }

  const list = async (tag: string, query = ""): Promise<AdminShipmentPage> => {
    const response = await app.inject({
      method: "GET",
      url: `/internal/admin/shipments?q=${encodeURIComponent(tag)}${query ? `&${query}` : ""}`,
    });
    expect(response.statusCode).toBe(200);
    return response.json();
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

    const usersClient = createFakeUsersClient({});
    const original = usersClient.findPublicProfile.bind(usersClient);
    usersClient.findPublicProfile = async (userId, callerId) => {
      lookups.push(userId);
      return (await original(userId, callerId)) ?? fakePublicProfile({ id: userId, fullName: `Resuelto ${userId.slice(0, 4)}` });
    };

    app = buildApp({ usersClient, storageProvider: createMockStorageProvider(), notificationsClient: { sendPush: async () => undefined } });
    await app.ready();
    repo = createShipmentRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  describe("listado", () => {
    it("por defecto devuelve solo los activos, incluidos los dos estados que faltaban", async () => {
      const tag = `act${randomUUID().slice(0, 8)}`;
      const activeIds: string[] = [];
      for (const status of ACTIVE_SHIPMENT_STATUSES) {
        activeIds.push((await seed(tag, status)).id);
      }
      const closedIds = [
        (await seed(tag, ShipmentStatus.DELIVERED)).id,
        (await seed(tag, ShipmentStatus.COMPLETED)).id,
        (await seed(tag, ShipmentStatus.CANCELLED)).id,
      ];

      const page = await list(tag, "limit=100");

      const ids = page.items.map((item) => item.id);
      expect(ids.sort()).toEqual([...activeIds].sort());
      expect(closedIds.some((id) => ids.includes(id))).toBe(false);
      const statuses = page.items.map((item) => item.status);
      expect(statuses).toContain("awaiting_receiver_confirmation");
      expect(statuses).toContain("rejected_by_receiver");
    });

    it("`status` y `group` piden otros estados, los cerrados incluidos", async () => {
      const tag = `grp${randomUUID().slice(0, 8)}`;
      const delivered = await seed(tag, ShipmentStatus.DELIVERED);
      const cancelled = await seed(tag, ShipmentStatus.CANCELLED);
      await seed(tag, ShipmentStatus.PUBLISHED);

      const byGroup = await list(tag, "group=closed");
      expect(byGroup.items.map((item) => item.id).sort()).toEqual([delivered.id, cancelled.id].sort());

      const byStatus = await list(tag, "status=cancelled");
      expect(byStatus.items.map((item) => item.id)).toEqual([cancelled.id]);

      // `status` es lo más específico: gana sobre `group`.
      const both = await list(tag, "group=closed&status=delivered");
      expect(both.items.map((item) => item.id)).toEqual([delivered.id]);
    });

    it("cuenta cada pestaña con los mismos filtros de búsqueda, sin `group` ni `status`", async () => {
      const tag = `cnt${randomUUID().slice(0, 8)}`;
      await seed(tag, ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION);
      await seed(tag, ShipmentStatus.REJECTED_BY_RECEIVER);
      await seed(tag, ShipmentStatus.PUBLISHED);
      await seed(tag, ShipmentStatus.ASSIGNMENT_PENDING);
      await seed(tag, ShipmentStatus.ASSIGNED, { carrierId: randomUUID() });
      await seed(tag, ShipmentStatus.IN_TRANSIT, { carrierId: randomUUID() });
      await seed(tag, ShipmentStatus.DELIVERED);
      await seed(tag, ShipmentStatus.DISPUTED, { carrierId: randomUUID() });
      // Otro envío que no coincide con la búsqueda no cuenta.
      await seed(`otro${randomUUID().slice(0, 8)}`, ShipmentStatus.PUBLISHED);

      // La pestaña elegida no cambia los conteos: salen de la búsqueda, no del filtro de la lista.
      const page = await list(tag, "group=closed");

      expect(page.counts).toEqual({ all: 7, unassigned: 3, assigning: 1, in_progress: 2, closed: 1, disputes: 1 });
      expect(page.items).toHaveLength(1);
      expect(page.statusCounts).toMatchObject({ published: 1, in_transit: 1, delivered: 1, completed: 0, cancelled: 0 });
      expect(Object.keys(page.statusCounts).sort()).toEqual(Object.values(ShipmentStatus).sort());
    });

    it("`alert` deja los que llevan aviso y `alertCounts` los cuenta por pestaña", async () => {
      const tag = `alr${randomUUID().slice(0, 8)}`;
      const unfunded = await seed(tag, ShipmentStatus.ASSIGNED_UNFUNDED, { carrierId: randomUUID() });
      const rejected = await seed(tag, ShipmentStatus.REJECTED_BY_RECEIVER);
      const disputed = await seed(tag, ShipmentStatus.DISPUTED, { carrierId: randomUUID() });
      const delayed = await seed(tag, ShipmentStatus.IN_TRANSIT, {
        carrierId: randomUUID(),
        data: { transitAnomalyFlaggedAt: new Date() },
      });
      // Sin aviso: un `in_transit` al día y un publicado.
      await seed(tag, ShipmentStatus.IN_TRANSIT, { carrierId: randomUUID() });
      await seed(tag, ShipmentStatus.PUBLISHED);

      const all = await list(tag);
      expect(all.alertCounts).toEqual({ all: 4, unassigned: 1, assigning: 1, in_progress: 1, closed: 0, disputes: 1 });
      expect(all.counts.all).toBe(6);
      for (const item of all.items) {
        expect(isAdminShipmentAlert(item)).toBe([unfunded.id, rejected.id, disputed.id, delayed.id].includes(item.id));
      }

      const onlyAlerts = await list(tag, "alert=true");
      expect(onlyAlerts.items.map((item) => item.id).sort()).toEqual([unfunded.id, rejected.id, disputed.id, delayed.id].sort());
      // Con el filtro puesto, las pestañas cuentan solo los que tienen aviso.
      expect(onlyAlerts.counts).toEqual(onlyAlerts.alertCounts);
    });

    it("ordena por último cambio de estado y pagina con cursor sin repetir ni saltear", async () => {
      const tag = `pag${randomUUID().slice(0, 8)}`;
      const base = Date.now();
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        // Los dos últimos comparten el mismo instante: el desempate es por id.
        const at = new Date(base - (i < 3 ? i * 60_000 : 3 * 60_000));
        ids.push((await seed(tag, ShipmentStatus.PUBLISHED, { at })).id);
      }

      const first = await list(tag, "limit=2");
      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).not.toBeNull();
      const second = await list(tag, `limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`);
      const third = await list(tag, `limit=2&cursor=${encodeURIComponent(second.nextCursor!)}`);

      const all = [...first.items, ...second.items, ...third.items];
      expect(all.map((item) => item.id).sort()).toEqual([...ids].sort());
      expect(third.nextCursor).toBeNull();
      const times = all.map((item) => Date.parse(item.lastStatusChangeAt));
      expect(times).toEqual([...times].sort((a, b) => b - a));
    });

    it("un cursor inválido es 400", async () => {
      const response = await app.inject({ method: "GET", url: "/internal/admin/shipments?cursor=basura" });
      expect(response.statusCode).toBe(400);
    });

    it("filtra por ciudad del retiro sin distinguir tildes ni mayúsculas", async () => {
      const tag = `cty${randomUUID().slice(0, 8)}`;
      const cordoba = await seed(tag, ShipmentStatus.PUBLISHED, { input: { pickupCity: "Córdoba" } });
      await seed(tag, ShipmentStatus.PUBLISHED, { input: { pickupCity: "Rosario" } });
      await seed(tag, ShipmentStatus.PUBLISHED, { input: { pickupCity: null } });

      const page = await list(tag, `city=${encodeURIComponent("CORDOBA")}`);

      expect(page.items.map((item) => item.id)).toEqual([cordoba.id]);
      expect(page.counts.all).toBe(1);
    });

    it("filtra por rango de fechas sobre el último cambio de estado", async () => {
      const tag = `fec${randomUUID().slice(0, 8)}`;
      const old = await seed(tag, ShipmentStatus.PUBLISHED, { at: new Date("2029-01-10T12:00:00.000Z") });
      const recent = await seed(tag, ShipmentStatus.PUBLISHED, { at: new Date("2029-03-10T12:00:00.000Z") });

      const from = await list(tag, `from=${encodeURIComponent("2029-02-01T00:00:00.000Z")}`);
      expect(from.items.map((item) => item.id)).toEqual([recent.id]);
      const to = await list(tag, `to=${encodeURIComponent("2029-02-01T00:00:00.000Z")}`);
      expect(to.items.map((item) => item.id)).toEqual([old.id]);
      const between = await list(tag, `from=${encodeURIComponent("2029-01-01T00:00:00.000Z")}&to=${encodeURIComponent("2029-12-31T00:00:00.000Z")}`);
      expect(between.items).toHaveLength(2);
    });

    it("busca por código, nombre de cualquiera de las partes y dirección, sin tildes ni mayúsculas", async () => {
      const tag = `bus${randomUUID().slice(0, 8)}`;
      const target = await seed(tag, ShipmentStatus.IN_TRANSIT, { carrierId: randomUUID() });
      await app.db.userDisplayName.update({ where: { userId: target.carrierId! }, data: { name: `José Ñandú ${tag}` } });
      await app.db.shipment.update({ where: { id: target.id }, data: { pickupAddress: `Pasaje Ángel Gallardo 1 ${tag}` } });
      const other = await seed(tag, ShipmentStatus.IN_TRANSIT, { carrierId: randomUUID() });

      const search = async (q: string) => {
        const response = await app.inject({ method: "GET", url: `/internal/admin/shipments?q=${encodeURIComponent(q)}&limit=100` });
        return (response.json() as AdminShipmentPage).items.map((item) => item.id);
      };

      expect(await search(target.id.slice(0, 8))).toContain(target.id);
      expect(await search(`#${target.id.slice(0, 8).toUpperCase()}`)).toContain(target.id);
      expect(await search(`jose nandu ${tag}`.toUpperCase())).toEqual([target.id]);
      expect(await search(`emisor ${tag}`)).toEqual(expect.arrayContaining([target.id, other.id]));
      expect(await search(`receptor ${tag}`)).toEqual(expect.arrayContaining([target.id, other.id]));
      expect(await search(`angel gallardo 1 ${tag}`)).toEqual([target.id]);
      // Los comodines de LIKE no son comodines acá.
      expect(await search("%")).toEqual([]);
    });

    it("arma la fila: partes, ciudades, precio, avisos y fechas límite", async () => {
      const tag = `fil${randomUUID().slice(0, 8)}`;
      const carrierId = randomUUID();
      const delayed = await seed(tag, ShipmentStatus.IN_TRANSIT, {
        carrierId,
        data: { agreedPriceArs: 5200, transitAnomalyFlaggedAt: new Date() },
      });
      const noCarrier = await seed(tag, ShipmentStatus.PUBLISHED);
      const rejected = await seed(tag, ShipmentStatus.REJECTED_BY_RECEIVER, {
        data: { receiverRedesignationDeadline: new Date("2030-01-05T10:00:00.000Z") },
      });
      const unfunded = await seed(tag, ShipmentStatus.ASSIGNED_UNFUNDED, { carrierId: randomUUID(), data: { agreedPriceArs: 4800 } });

      const page = await list(tag, "limit=100");
      const byId = new Map(page.items.map((item) => [item.id, item]));

      const inTransit = byId.get(delayed.id)!;
      expect(inTransit).toMatchObject({
        code: delayed.id.slice(0, 8),
        status: "in_transit",
        sender: { id: delayed.senderId, name: `Emisor ${tag}` },
        carrier: { id: carrierId, name: `Transportista ${tag}` },
        receiver: { id: delayed.receiverId, name: `Receptor ${tag}` },
        pickupCity: "Córdoba",
        deliveryCity: "Villa María",
        pickupAddress: `Av. Colón 1234 ${tag}`,
        pickupDate: "2030-01-01",
        pickupTimeWindowStart: "09:00",
        pickupTimeWindowEnd: "12:00",
        priceArs: 5200,
        priceKind: "agreed",
        delayed: true,
        disputeId: null,
        fundingDeadline: null,
        redesignationDeadline: null,
      });

      expect(byId.get(noCarrier.id)).toMatchObject({ carrier: null, priceArs: 4500, priceKind: "suggested", delayed: false });
      expect(byId.get(rejected.id)?.redesignationDeadline).toBe("2030-01-05T10:00:00.000Z");
      expect(byId.get(unfunded.id)?.fundingDeadline).toEqual(expect.any(String));
    });

    it("`delayed` solo vale en `in_transit`", async () => {
      const tag = `del${randomUUID().slice(0, 8)}`;
      const stale = await seed(tag, ShipmentStatus.DISPUTED, { carrierId: randomUUID(), data: { transitAnomalyFlaggedAt: new Date() } });

      const page = await list(tag);

      expect(page.items.find((item) => item.id === stale.id)?.delayed).toBe(false);
    });

    it("completa el nombre faltante desde svc-users, lo guarda y no lo vuelve a pedir", async () => {
      const tag = `hea${randomUUID().slice(0, 8)}`;
      const shipment = await seed(tag, ShipmentStatus.PUBLISHED, { names: false });
      await app.db.shipment.update({ where: { id: shipment.id }, data: { pickupAddress: `Calle ${tag}` } });

      const first = await list(tag);
      expect(first.items[0]?.sender.name).toBe(`Resuelto ${shipment.senderId.slice(0, 4)}`);
      expect(first.items[0]?.receiver.name).toBe(`Resuelto ${shipment.receiverId.slice(0, 4)}`);
      expect(await app.db.userDisplayName.count({ where: { userId: { in: [shipment.senderId, shipment.receiverId] } } })).toBe(2);

      const before = lookups.length;
      await list(tag);
      expect(lookups.length).toBe(before);
    });

    it("si svc-users no responde, el listado sale igual con el nombre en null", async () => {
      const failing = createFakeUsersClient({});
      failing.findPublicProfile = async () => {
        throw new Error("caído");
      };
      const downApp = buildApp({ usersClient: failing, storageProvider: createMockStorageProvider() });
      await downApp.ready();
      const tag = `cai${randomUUID().slice(0, 8)}`;
      const shipment = await seed(tag, ShipmentStatus.PUBLISHED, { names: false });

      const response = await downApp.inject({ method: "GET", url: `/internal/admin/shipments?q=${shipment.id.slice(0, 8)}` });

      expect(response.statusCode).toBe(200);
      const item = (response.json() as AdminShipmentPage).items.find((candidate) => candidate.id === shipment.id);
      expect(item?.sender.name).toBeNull();
      await downApp.close();
    });
  });

  describe("detalle", () => {
    it("devuelve el envío completo", async () => {
      const tag = `det${randomUUID().slice(0, 8)}`;
      const carrierId = randomUUID();
      const shipment = await seed(tag, ShipmentStatus.IN_TRANSIT, { carrierId, data: { agreedPriceArs: 5200, urgent: true } });

      const response = await app.inject({ method: "GET", url: `/internal/admin/shipments/${shipment.id}` });

      expect(response.statusCode).toBe(200);
      expect(response.json() as AdminShipmentDetail).toMatchObject({
        id: shipment.id,
        status: "in_transit",
        packageType: "standard_package",
        weightKg: 2.5,
        urgent: true,
        pickupLat: -31.4201,
        deliveryLng: -63.2406,
        agreedPriceArs: 5200,
        suggestedPriceArs: 4500,
        carrier: { id: carrierId },
      });
    });

    it("un envío inexistente es 404 en cada ruta", async () => {
      const id = randomUUID();
      for (const suffix of ["", "/events", "/offers", "/photos", "/chat/messages"]) {
        const response = await app.inject({ method: "GET", url: `/internal/admin/shipments/${id}${suffix}` });
        expect(response.statusCode).toBe(404);
      }
    });

    it("lista los eventos del historial", async () => {
      const shipment = await seed(`evt${randomUUID().slice(0, 8)}`, ShipmentStatus.PUBLISHED);

      const response = await app.inject({ method: "GET", url: `/internal/admin/shipments/${shipment.id}/events` });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([expect.objectContaining({ fromStatus: null, toStatus: "awaiting_receiver_confirmation" })]);
    });

    it("lista todas las ofertas con su estado efectivo, el desglose y las franjas en HH:MM", async () => {
      const carrierId = randomUUID();
      const shipment = await seed(`ofr${randomUUID().slice(0, 8)}`, ShipmentStatus.ASSIGNMENT_PENDING, { carrierId });
      const base = { shipmentId: shipment.id, offeredDate: new Date("2030-01-01T00:00:00.000Z") };
      await app.db.offer.create({
        data: {
          ...base,
          carrierId,
          priceOffered: 11500,
          status: "accepted",
          carrierNameAtOffer: "Lucas Ferreyra",
          carrierRatingAtOffer: 4.8,
          message: "Paso temprano",
          estimatedDeliveryDate: new Date("2030-01-01T00:00:00.000Z"),
          estimatedDeliveryTimeWindowStart: "16:00:00",
          estimatedDeliveryTimeWindowEnd: "19:00:00",
          createdAt: new Date("2029-12-30T10:00:00.000Z"),
          respondedAt: new Date("2029-12-30T12:00:00.000Z"),
        },
      });
      // `pending` con `expiresAt` vencido: se reporta `expired` sin tocar la fila (AC11 de MOVO-104).
      await app.db.offer.create({
        data: {
          ...base,
          carrierId: randomUUID(),
          priceOffered: 9200,
          status: "pending",
          offeredPickupTimeWindowStart: "14:00:00",
          offeredPickupTimeWindowEnd: "18:00:00",
          expiresAt: new Date("2020-01-01T00:00:00.000Z"),
          createdAt: new Date("2029-12-30T11:00:00.000Z"),
        },
      });

      const response = await app.inject({ method: "GET", url: `/internal/admin/shipments/${shipment.id}/offers` });

      expect(response.statusCode).toBe(200);
      const [accepted, expired] = response.json() as AdminShipmentOffer[];
      expect(accepted).toMatchObject({
        carrierId,
        carrierName: "Lucas Ferreyra",
        carrierRatingAtOffer: 4.8,
        status: "accepted",
        priceArs: 11500,
        netArs: 10000,
        commissionArs: 1500,
        offeredDate: "2030-01-01",
        pickupTimeWindowStart: null,
        estimatedDeliveryDate: "2030-01-01",
        estimatedDeliveryTimeWindowStart: "16:00",
        estimatedDeliveryTimeWindowEnd: "19:00",
        message: "Paso temprano",
        viewedAtBySender: null,
        respondedAt: "2029-12-30T12:00:00.000Z",
      });
      expect(accepted.receivedEstimateArs).toBeCloseTo(accepted.netArs - accepted.mpFeeEstimateArs, 2);
      expect(expired).toMatchObject({ status: "expired", pickupTimeWindowStart: "14:00", pickupTimeWindowEnd: "18:00" });
    });

    it("lista las fotos con una URL firmada", async () => {
      const shipment = await seed(`pho${randomUUID().slice(0, 8)}`, ShipmentStatus.IN_TRANSIT, { carrierId: randomUUID() });
      await app.db.shipmentPhoto.createMany({
        data: [
          { shipmentId: shipment.id, stage: "pickup", s3Key: `shipments/${shipment.id}/pickup.jpg` },
          { shipmentId: shipment.id, stage: "delivery", s3Key: `shipments/${shipment.id}/delivery.jpg` },
        ],
      });

      const response = await app.inject({ method: "GET", url: `/internal/admin/shipments/${shipment.id}/photos` });

      expect(response.statusCode).toBe(200);
      const photos = response.json() as Array<{ stage: string; url: string }>;
      expect(photos.map((photo) => photo.stage).sort()).toEqual(["delivery", "pickup"]);
      expect(photos.every((photo) => photo.url.length > 0)).toBe(true);
    });
  });

  describe("chat", () => {
    it("devuelve todo el hilo sin ocultar nada, con la moderación, el rol, los reportes y el acceso", async () => {
      const carrierId = randomUUID();
      const shipment = await seed(`cha${randomUUID().slice(0, 8)}`, ShipmentStatus.IN_TRANSIT, { carrierId });
      const startedAt = new Date();
      // El corte de la última asignación posterior a los mensajes: a las partes les oculta todo, al admin no.
      await app.db.shipment.update({ where: { id: shipment.id }, data: { chatStartedAt: new Date(startedAt.getTime() + 60_000) } });
      const base = Date.now() - 10_000;
      await app.db.chatMessage.createMany({
        data: [
          { shipmentId: shipment.id, authorId: shipment.senderId, authorName: "Ana", body: "Hola", clientMessageId: randomUUID(), createdAt: new Date(base) },
          { shipmentId: shipment.id, authorId: carrierId, authorName: "Carlos", body: "**** vos", moderated: true, clientMessageId: randomUUID(), createdAt: new Date(base + 1000) },
          { shipmentId: shipment.id, authorId: randomUUID(), authorName: "Otro", body: "Ex transportista", clientMessageId: randomUUID(), createdAt: new Date(base + 2000) },
        ],
      });
      await app.db.chatReport.create({ data: { shipmentId: shipment.id, reporterId: shipment.receiverId } });

      const response = await app.inject({ method: "GET", url: `/internal/admin/shipments/${shipment.id}/chat/messages` });

      expect(response.statusCode).toBe(200);
      const page = response.json() as AdminChatPage;
      expect(page.items.map((message) => message.body)).toEqual(["Ex transportista", "**** vos", "Hola"]);
      expect(page.items.map((message) => message.authorRole)).toEqual([null, "carrier", "sender"]);
      expect(page.items.find((message) => message.body === "**** vos")?.moderated).toBe(true);
      expect(page.reports).toEqual([expect.objectContaining({ reporterId: shipment.receiverId, reporterRole: "receiver" })]);
      expect(page.partiesAccess).toBe("open");
      expect(page.archived).toBe(false);
      expect(page.events.length).toBeGreaterThan(0);
    });

    it("las partes solo leen en un envío en disputa o entregado, y no ven nada si se canceló", async () => {
      const read = await seed(`chr${randomUUID().slice(0, 8)}`, ShipmentStatus.DISPUTED, { carrierId: randomUUID() });
      const closed = await seed(`chc${randomUUID().slice(0, 8)}`, ShipmentStatus.CANCELLED, { carrierId: randomUUID() });

      const readPage = (await app.inject({ method: "GET", url: `/internal/admin/shipments/${read.id}/chat/messages` })).json() as AdminChatPage;
      const closedResponse = await app.inject({ method: "GET", url: `/internal/admin/shipments/${closed.id}/chat/messages` });

      expect(readPage.partiesAccess).toBe("read_only");
      // El admin igual lo lee: el hilo no se corta aunque las partes ya no lo vean.
      expect(closedResponse.statusCode).toBe(200);
      expect((closedResponse.json() as AdminChatPage).partiesAccess).toBe("closed");
    });

    it("pagina con cursor", async () => {
      const shipment = await seed(`chp${randomUUID().slice(0, 8)}`, ShipmentStatus.IN_TRANSIT, { carrierId: randomUUID() });
      const base = Date.now() - 10_000;
      await app.db.chatMessage.createMany({
        data: Array.from({ length: 3 }, (_, i) => ({
          shipmentId: shipment.id,
          authorId: shipment.senderId,
          body: `m${i}`,
          clientMessageId: randomUUID(),
          createdAt: new Date(base + i * 1000),
        })),
      });

      const first = (await app.inject({ method: "GET", url: `/internal/admin/shipments/${shipment.id}/chat/messages?limit=2` })).json() as AdminChatPage;
      const second = (await app.inject({
        method: "GET",
        url: `/internal/admin/shipments/${shipment.id}/chat/messages?limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`,
      })).json() as AdminChatPage;

      expect(first.items.map((message) => message.body)).toEqual(["m2", "m1"]);
      expect(second.items.map((message) => message.body)).toEqual(["m0"]);
      expect(second.nextCursor).toBeNull();
    });
  });
});
