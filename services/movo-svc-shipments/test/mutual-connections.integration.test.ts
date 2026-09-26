import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { CreateShipmentInput, PackageType } from "../src/models/shipment";
import { createFakeUsersClient } from "./fake-users-client";

type FixtureStatus = "delivered" | "completed" | "cancelled" | "published" | "in_transit" | "rejected_by_receiver";

describe("Conexiones mutuas — GET /internal/users/:userId/mutual-connections/:otherId (Postgres) — MOVO-174", () => {
  let app: FastifyInstance;
  let shipmentRepo: ShipmentRepository;

  const viewer = randomUUID();
  const other = randomUUID();
  const personX = randomUUID();
  const personY = randomUUID();
  const personZ = randomUUID();

  function baseInput(senderId: string, receiverId: string): CreateShipmentInput {
    return {
      senderId,
      receiverId,
      packageType: PackageType.standard_package,
      weightKg: 2.5,
      lengthCm: 30,
      widthCm: 20,
      heightCm: 15,
      description: "Caja",
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
    };
  }

  /** Fixture: crea el envío y fuerza `status`/`carrierId` directo en la base (no es el flujo real). */
  async function shipment(
    senderId: string,
    receiverId: string,
    carrierId: string | null,
    status: FixtureStatus,
  ): Promise<void> {
    const created = await shipmentRepo.create(baseInput(senderId, receiverId));
    await app.db.shipment.update({ where: { id: created.id }, data: { carrierId, status } });
  }

  async function mutualCount(userId: string, otherId: string): Promise<number> {
    const response = await app.inject({
      method: "GET",
      url: `/internal/users/${userId}/mutual-connections/${otherId}`,
    });
    expect(response.statusCode).toBe(200);
    return response.json().totalCount;
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

    app = buildApp({
      usersClient: createFakeUsersClient({}),
      notificationsClient: { sendPush: async () => undefined },
    });
    await app.ready();
    shipmentRepo = createShipmentRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments RESTART IDENTITY CASCADE");
  });

  it("sin envíos en común devuelve 0 (0 conexiones mutuas)", async () => {
    await shipment(viewer, personX, null, "delivered");
    await shipment(other, personY, null, "delivered");

    expect(await mutualCount(viewer, other)).toBe(0);
  });

  it("usuarios sin ningún envío devuelven 0", async () => {
    expect(await mutualCount(randomUUID(), randomUUID())).toBe(0);
  });

  it("una contraparte compartida cuenta como 1 conexión mutua", async () => {
    await shipment(viewer, personX, null, "delivered"); // viewer → X
    await shipment(personX, other, null, "delivered"); // X → other

    expect(await mutualCount(viewer, other)).toBe(1);
  });

  it("N contrapartes compartidas, en cualquier rol, cuentan cada una una sola vez", async () => {
    // X: viewer le envió, otro le recibió.
    await shipment(viewer, personX, null, "delivered");
    await shipment(personX, other, null, "delivered");
    // Y: viewer fue transportista de Y, otro fue transportista de Y (roles mezclados).
    await shipment(personY, randomUUID(), viewer, "delivered");
    await shipment(personY, randomUUID(), other, "completed");
    // Z: viewer recibió de Z, otro envió a Z.
    await shipment(personZ, viewer, null, "delivered");
    await shipment(other, personZ, null, "delivered");
    // X repetida en otro envío: no debe contarse dos veces.
    await shipment(viewer, personX, null, "delivered");

    expect(await mutualCount(viewer, other)).toBe(3);
  });

  it("es simétrico: intercambiar viewer y visitado da el mismo número", async () => {
    await shipment(viewer, personX, null, "delivered");
    await shipment(personX, other, null, "delivered");

    expect(await mutualCount(viewer, other)).toBe(await mutualCount(other, viewer));
  });

  it("solo cuentan envíos entregados (delivered/completed), no cancelados, rechazados ni en curso", async () => {
    await shipment(viewer, personX, null, "delivered");
    // Del lado del visitado la relación con X existe pero en estados que no cuentan.
    await shipment(personX, other, null, "cancelled");
    await shipment(personX, other, null, "published");
    await shipment(personX, other, null, "in_transit");
    await shipment(personX, other, null, "rejected_by_receiver");
    expect(await mutualCount(viewer, other)).toBe(0);

    // Un `completed` (entregado Y pagado) sí cuenta.
    await shipment(personX, other, null, "completed");
    expect(await mutualCount(viewer, other)).toBe(1);
  });

  it("un envío directo entre el viewer y el visitado no es una conexión mutua", async () => {
    await shipment(viewer, other, null, "delivered");
    await shipment(other, viewer, null, "delivered");

    expect(await mutualCount(viewer, other)).toBe(0);
  });

  it("los dos usuarios quedan excluidos aunque un tercero los una a ambos", async () => {
    // X viajó con los dos; el viewer y el visitado también enviaron entre sí.
    await shipment(viewer, personX, other, "delivered");
    await shipment(viewer, other, null, "delivered");

    // Solo X es contraparte de ambos; ni viewer ni other se cuentan a sí mismos.
    expect(await mutualCount(viewer, other)).toBe(1);
  });

  it("un envío sin transportista asignado no rompe el conteo", async () => {
    await shipment(viewer, personX, null, "delivered");
    await shipment(personX, other, null, "delivered");

    expect(await mutualCount(viewer, other)).toBe(1);
  });

  it("400 si algún id no es un uuid", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/internal/users/${viewer}/mutual-connections/no-es-un-uuid`,
    });

    expect(response.statusCode).toBe(400);
  });

  it("no se documenta en la Swagger pública (endpoint interno)", () => {
    const spec = app.swagger() as { paths: Record<string, unknown> };
    expect(Object.keys(spec.paths).some((path) => path.includes("mutual-connections"))).toBe(false);
  });
});
