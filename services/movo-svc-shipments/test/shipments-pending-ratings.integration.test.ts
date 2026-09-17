import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { ShipmentStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { CreateShipmentInput, PackageType, PhotoStage } from "../src/models/shipment";
import { RatingRole } from "../src/models/rating";
import { createFakeUsersClient } from "./fake-users-client";

/**
 * MOVO-222: GET /shipments/pending-ratings -- envíos delivered/completed donde el
 * caller (en cualquier rol -- emisor, receptor o transportista) todavía tiene alguna
 * contraparte sin calificar dentro de la ventana de 72hs. DoD del ticket: casos límite
 * de envío delivered con ventana vencida, ya calificado, y calificado parcialmente
 * (transportista con 2 contrapartes) -- los tres cubiertos acá contra Postgres real.
 */
describe("GET /shipments/pending-ratings (Postgres)", () => {
  let app: FastifyInstance;
  let repo: ShipmentRepository;

  const senderId = randomUUID();
  const receiverId = randomUUID();
  const carrierId = randomUUID();

  function baseInput(overrides: Partial<CreateShipmentInput> = {}): CreateShipmentInput {
    return {
      senderId,
      receiverId,
      packageType: PackageType.standard_package,
      weightKg: 2,
      lengthCm: 20,
      widthCm: 15,
      heightCm: 10,
      pickupAddress: "Av. Colón 1234, Córdoba",
      pickupLat: -31.4201,
      pickupLng: -64.1888,
      deliveryAddress: "Bv. San Juan 500, Córdoba",
      deliveryLat: -31.4135,
      deliveryLng: -64.1811,
      pickupDate: new Date("2030-01-01T00:00:00.000Z"),
      pickupTimeWindowStart: new Date("1970-01-01T09:00:00.000Z"),
      pickupTimeWindowEnd: new Date("1970-01-01T12:00:00.000Z"),
      suggestedPriceArs: 4500,
      ...overrides,
    };
  }

  /** Lleva un envío recién creado hasta `delivered` (o `completed`, si se pide), con
   * `deliveredAt` opcionalmente corrido hacia el pasado para simular una ventana ya
   * vencida -- `updateStatus` fija `deliveredAt: now` al transicionar a `delivered`
   * (ver shipment-repository.ts), así que el corrimiento se aplica con un `update`
   * crudo después, mismo criterio que `createActiveShipment` en
   * shipments-active.integration.test.ts. */
  async function createDeliveredShipment(
    opts: { deliveredHoursAgo?: number; completed?: boolean; inputOverrides?: Partial<CreateShipmentInput> } = {},
  ): Promise<string> {
    const created = await repo.create(baseInput(opts.inputOverrides));
    await repo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    await repo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    await repo.updateStatus(created.id, ShipmentStatus.PUBLISHED, null);
    await repo.updateStatus(created.id, ShipmentStatus.ASSIGNMENT_PENDING, null);
    await app.db.shipment.update({ where: { id: created.id }, data: { carrierId } });
    await repo.updateStatus(created.id, ShipmentStatus.ASSIGNED, null);
    await repo.updateStatus(created.id, ShipmentStatus.IN_TRANSIT, null);
    await repo.updateStatus(created.id, ShipmentStatus.DELIVERED, null);

    if (opts.deliveredHoursAgo !== undefined) {
      const deliveredAt = new Date(Date.now() - opts.deliveredHoursAgo * 60 * 60 * 1000);
      await app.db.shipment.update({ where: { id: created.id }, data: { deliveredAt } });
    }
    if (opts.completed) {
      await repo.updateStatus(created.id, ShipmentStatus.COMPLETED, null);
    }
    return created.id;
  }

  async function createRating(shipmentId: string, raterId: string, rateeId: string, role: RatingRole) {
    await app.db.rating.create({ data: { shipmentId, raterId, rateeId, role, score: 5 } });
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

    app = buildApp({ usersClient: createFakeUsersClient({}) });
    await app.ready();
    repo = createShipmentRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // CASCADE también vacía shipments.ratings (FK a shipments.shipments).
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments RESTART IDENTITY CASCADE");
  });

  function request(userId?: string) {
    return app.inject({
      method: "GET",
      url: "/shipments/pending-ratings",
      headers: userId ? { "x-user-id": userId } : {},
    });
  }

  it("401 sin x-user-id", async () => {
    const response = await request();
    expect(response.statusCode).toBe(401);
  });

  it("lista vacía (200, no 404) sin ningún envío entregado", async () => {
    const response = await request(senderId);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it("emisor con algo pendiente -- pendingRatingFor: [carrier]", async () => {
    const shipmentId = await createDeliveredShipment();

    const response = await request(senderId);

    expect(response.statusCode).toBe(200);
    const items = response.json();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: shipmentId,
      status: "delivered",
      senderId,
      receiverId,
      carrierId,
      pendingRatingFor: ["carrier"],
    });
    expect(items[0].deliveredAt).not.toBeNull();
    // MOVO-222 (corregido en review): deadline absoluto ya resuelto por el backend,
    // no un timestamp crudo que el cliente tenga que sumarle 72hs a mano.
    expect(items[0].ratingDeadline).not.toBeNull();
    expect(new Date(items[0].ratingDeadline).getTime()).toBeGreaterThan(
      new Date(items[0].deliveredAt).getTime(),
    );
  });

  it("receptor con algo pendiente -- pendingRatingFor: [carrier]", async () => {
    await createDeliveredShipment();

    const response = await request(receiverId);

    expect(response.json()).toMatchObject([{ pendingRatingFor: ["carrier"] }]);
  });

  it("MOVO-208: completed también es calificable, igual que delivered", async () => {
    await createDeliveredShipment({ completed: true });

    const response = await request(senderId);

    expect(response.json()).toMatchObject([{ status: "completed", pendingRatingFor: ["carrier"] }]);
  });

  it("DoD: ya calificado -- no aparece en la lista", async () => {
    const shipmentId = await createDeliveredShipment();
    await createRating(shipmentId, senderId, carrierId, RatingRole.carrier);

    const response = await request(senderId);

    expect(response.json()).toEqual([]);
  });

  it("DoD: ventana de 72hs vencida -- no aparece en la lista", async () => {
    await createDeliveredShipment({ deliveredHoursAgo: 73 });

    const response = await request(senderId);

    expect(response.json()).toEqual([]);
  });

  it("bug de review: prefiltro SQL no descarta un candidato con freeze de disputa que extendió la ventana más allá de las 72hs crudas", async () => {
    // Entregado hace 80hs -- pasadas las 72hs crudas, pero con 20hs de freeze de
    // disputa (10h -> 30h desde la entrega) la ventana real cierra a las 92hs, todavía
    // abierta. `disputed` no tiene transición de salida modelada hoy
    // (shipment-state-machine.ts), así que los eventos se insertan directo contra la
    // tabla -- mismo criterio que `deliveredHoursAgo` más arriba para simular un
    // estado que la máquina de estados actual no permite alcanzar por sí sola.
    const shipmentId = await createDeliveredShipment({ deliveredHoursAgo: 80 });
    const shipment = await app.db.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
    const deliveredAt = shipment.deliveredAt as Date;
    await app.db.shipmentEvent.create({
      data: {
        shipmentId,
        fromStatus: ShipmentStatus.DELIVERED,
        toStatus: ShipmentStatus.DISPUTED,
        createdAt: new Date(deliveredAt.getTime() + 10 * 60 * 60 * 1000),
      },
    });
    await app.db.shipmentEvent.create({
      data: {
        shipmentId,
        fromStatus: ShipmentStatus.DISPUTED,
        toStatus: ShipmentStatus.DELIVERED,
        createdAt: new Date(deliveredAt.getTime() + 30 * 60 * 60 * 1000),
      },
    });

    const response = await request(senderId);

    expect(response.statusCode).toBe(200);
    const items = response.json();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: shipmentId, pendingRatingFor: ["carrier"] });
  });

  it("DoD: transportista con 2 contrapartes calificado PARCIALMENTE -- solo la que falta queda pendiente", async () => {
    const shipmentId = await createDeliveredShipment();
    await createRating(shipmentId, carrierId, senderId, RatingRole.sender);

    const response = await request(carrierId);

    expect(response.statusCode).toBe(200);
    const items = response.json();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: shipmentId, pendingRatingFor: ["receiver"] });
  });

  it("transportista sin calificar a nadie todavía -- pendingRatingFor: [sender, receiver]", async () => {
    await createDeliveredShipment();

    const response = await request(carrierId);

    const items = response.json();
    expect(items).toHaveLength(1);
    expect(items[0].pendingRatingFor.sort()).toEqual(["receiver", "sender"]);
  });

  it("gap real que motivó el endpoint dedicado: el mismo envío no aparece para el transportista en GET /shipments/mine", async () => {
    await createDeliveredShipment();

    const mine = await app.inject({
      method: "GET",
      url: "/shipments/mine",
      headers: { "x-user-id": carrierId },
    });

    expect(mine.json().items).toEqual([]);
  });

  it("AC9: envío que pasó a disputed después de entregado -- no aparece (la disputa suspende la calificación)", async () => {
    const shipmentId = await createDeliveredShipment();
    await repo.updateStatus(shipmentId, ShipmentStatus.DISPUTED, null);

    const response = await request(senderId);

    expect(response.json()).toEqual([]);
  });

  it("un tercero ajeno al envío no ve nada pendiente", async () => {
    await createDeliveredShipment();

    const response = await request(randomUUID());

    expect(response.json()).toEqual([]);
  });
});
