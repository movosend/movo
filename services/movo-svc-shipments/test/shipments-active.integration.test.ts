import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { FastifyInstance } from "fastify";
import { ShipmentStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { createShipmentRepository, ShipmentRepository } from "../src/repositories/shipment-repository";
import { CreateShipmentInput, PackageType, PhotoStage } from "../src/models/shipment";
import { createFakeUsersClient, fakePublicProfile } from "./fake-users-client";

/**
 * MOVO-192: GET /shipments/sending|transporting|receiving -- envíos activos
 * (assigned_unfunded/assigned/in_transit) del usuario autenticado por rol.
 */
describe("GET /shipments/sending|transporting|receiving (Postgres)", () => {
  let app: FastifyInstance;
  let repo: ShipmentRepository;

  const userX = randomUUID();
  const senderId = randomUUID();
  const carrierId = randomUUID();
  const receiverId = randomUUID();
  const strangerId = randomUUID();

  const fakeUsersClient = createFakeUsersClient({
    [carrierId]: fakePublicProfile({ id: carrierId, fullName: "Juan Perez" }),
    [senderId]: fakePublicProfile({ id: senderId, fullName: "Maria Lopez" }),
    [receiverId]: fakePublicProfile({ id: receiverId, fullName: "Ana Garcia" }),
  });

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

  /**
   * Lleva un envío recién creado hasta uno de los tres estados activos, replicando a
   * mano lo que en producción hace la aceptación de una oferta (`offer-repository.ts
   * #acceptOffer` fija `carrierId` en la transición a `assignment_pending`) -- acá se
   * llama a `repository.updateStatus` directo (bypass del flujo de ofertas, igual que
   * `shipments-history-with.integration.test.ts`) y se fija `carrierId`/
   * `agreedPriceArs` con un `update` crudo en el medio.
   */
  async function createActiveShipment(opts: {
    status: ShipmentStatus.ASSIGNED_UNFUNDED | ShipmentStatus.ASSIGNED | ShipmentStatus.IN_TRANSIT;
    carrierId: string;
    agreedPriceArs?: number | null;
    inputOverrides?: Partial<CreateShipmentInput>;
  }): Promise<string> {
    const created = await repo.create(baseInput(opts.inputOverrides));
    await repo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    await repo.addPhoto(created.id, PhotoStage.creation, `shipments/${created.id}/creation/${randomUUID()}.jpg`);
    await repo.updateStatus(created.id, ShipmentStatus.PUBLISHED, null);

    // `assigned_unfunded` (MOVO-208) es una rama ALTERNATIVA a `assignment_pending`
    // desde `published`, no un paso posterior de esa misma ruta (ver
    // shipment-state-machine.ts) -- ambas fijan carrierId al salir de `published`,
    // igual que la aceptación real de una oferta.
    if (opts.status === ShipmentStatus.ASSIGNED_UNFUNDED) {
      await repo.updateStatus(created.id, ShipmentStatus.ASSIGNED_UNFUNDED, null);
      await app.db.shipment.update({
        where: { id: created.id },
        data: { carrierId: opts.carrierId, agreedPriceArs: opts.agreedPriceArs ?? null },
      });
      return created.id;
    }

    await repo.updateStatus(created.id, ShipmentStatus.ASSIGNMENT_PENDING, null);
    await app.db.shipment.update({
      where: { id: created.id },
      data: { carrierId: opts.carrierId, agreedPriceArs: opts.agreedPriceArs ?? null },
    });
    await repo.updateStatus(created.id, ShipmentStatus.ASSIGNED, null);
    if (opts.status === ShipmentStatus.IN_TRANSIT) {
      await repo.updateStatus(created.id, ShipmentStatus.IN_TRANSIT, null);
    }
    return created.id;
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

    app = buildApp({ usersClient: fakeUsersClient });
    await app.ready();
    repo = createShipmentRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments RESTART IDENTITY CASCADE");
    vi.useRealTimers();
  });

  function request(path: string, userId?: string) {
    return app.inject({
      method: "GET",
      url: path,
      headers: userId ? { "x-user-id": userId } : {},
    });
  }

  it("401 sin x-user-id, en los tres endpoints", async () => {
    for (const path of ["/shipments/sending", "/shipments/transporting", "/shipments/receiving"]) {
      const response = await request(path);
      expect(response.statusCode).toBe(401);
    }
  });

  it("AC9: lista vacía (200, no 404) cuando el usuario no tiene envíos activos en ese rol", async () => {
    const response = await request("/shipments/sending", strangerId);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it("AC4: published/assignment_pending no cuentan como activos, solo assigned_unfunded/assigned/in_transit", async () => {
    // published: sin assignment_pending intermedio.
    const published = await repo.create(baseInput({ senderId: userX }));
    await repo.addPhoto(published.id, PhotoStage.creation, `shipments/${published.id}/creation/${randomUUID()}.jpg`);
    await repo.addPhoto(published.id, PhotoStage.creation, `shipments/${published.id}/creation/${randomUUID()}.jpg`);
    await repo.updateStatus(published.id, ShipmentStatus.PUBLISHED, null);

    // assignment_pending: con carrierId ya fijado, como en producción.
    const pending = await repo.create(baseInput({ senderId: userX }));
    await repo.addPhoto(pending.id, PhotoStage.creation, `shipments/${pending.id}/creation/${randomUUID()}.jpg`);
    await repo.addPhoto(pending.id, PhotoStage.creation, `shipments/${pending.id}/creation/${randomUUID()}.jpg`);
    await repo.updateStatus(pending.id, ShipmentStatus.PUBLISHED, null);
    await repo.updateStatus(pending.id, ShipmentStatus.ASSIGNMENT_PENDING, null);
    await app.db.shipment.update({ where: { id: pending.id }, data: { carrierId } });

    const response = await request("/shipments/sending", userX);
    expect(response.json()).toEqual([]);
  });

  it("MOVO-208: assigned_unfunded cuenta como activo", async () => {
    await createActiveShipment({ status: ShipmentStatus.ASSIGNED_UNFUNDED, carrierId, inputOverrides: { senderId: userX } });

    const response = await request("/shipments/sending", userX);
    expect(response.json()).toHaveLength(1);
    expect(response.json()[0].status).toBe("assigned_unfunded");
  });

  it("DoD: un usuario que es emisor de un envío y transportista de otro aparece en ambos endpoints y no en el tercero", async () => {
    await createActiveShipment({
      status: ShipmentStatus.ASSIGNED,
      carrierId,
      inputOverrides: { senderId: userX, receiverId },
    });
    await createActiveShipment({
      status: ShipmentStatus.ASSIGNED,
      carrierId: userX,
      inputOverrides: { senderId, receiverId },
    });

    const sending = await request("/shipments/sending", userX);
    const transporting = await request("/shipments/transporting", userX);
    const receiving = await request("/shipments/receiving", userX);

    expect(sending.json()).toHaveLength(1);
    expect(transporting.json()).toHaveLength(1);
    expect(receiving.json()).toEqual([]);
  });

  it("AC8: usuario A nunca ve los envíos activos de usuario B (no hay parámetro userId por ningún camino)", async () => {
    await createActiveShipment({ status: ShipmentStatus.ASSIGNED, carrierId, inputOverrides: { senderId: userX } });

    const responseForOwner = await request("/shipments/sending", userX);
    const responseForStranger = await request("/shipments/sending", strangerId);

    expect(responseForOwner.json()).toHaveLength(1);
    expect(responseForStranger.json()).toEqual([]);
  });

  it("AC5: /sending resuelve la contraparte contra el transportista asignado", async () => {
    await createActiveShipment({ status: ShipmentStatus.ASSIGNED, carrierId, inputOverrides: { senderId: userX } });

    const response = await request("/shipments/sending", userX);
    expect(response.json()[0].counterparty).toEqual({ name: "Juan Perez", initials: "JP" });
  });

  it("AC5: /receiving resuelve la contraparte contra el transportista asignado", async () => {
    await createActiveShipment({ status: ShipmentStatus.IN_TRANSIT, carrierId, inputOverrides: { receiverId: userX } });

    const response = await request("/shipments/receiving", userX);
    expect(response.json()[0].counterparty).toEqual({ name: "Juan Perez", initials: "JP" });
  });

  it("AC5: /transporting resuelve la contraparte contra el emisor mientras el paquete no salió (assigned)", async () => {
    await createActiveShipment({ status: ShipmentStatus.ASSIGNED, carrierId: userX, inputOverrides: { senderId } });

    const response = await request("/shipments/transporting", userX);
    expect(response.json()[0].counterparty).toEqual({ name: "Maria Lopez", initials: "ML" });
  });

  it("AC5: /transporting resuelve la contraparte contra el receptor una vez en tránsito (in_transit)", async () => {
    await createActiveShipment({ status: ShipmentStatus.IN_TRANSIT, carrierId: userX, inputOverrides: { receiverId } });

    const response = await request("/shipments/transporting", userX);
    expect(response.json()[0].counterparty).toEqual({ name: "Ana Garcia", initials: "AG" });
  });

  it("AC7: orden por pickupDate ascendente y, dentro del mismo día, por pickupTimeWindowStart ascendente", async () => {
    const later = await createActiveShipment({
      status: ShipmentStatus.ASSIGNED,
      carrierId,
      inputOverrides: {
        senderId: userX,
        pickupDate: new Date("2030-01-05T00:00:00.000Z"),
      },
    });
    const sameDayLate = await createActiveShipment({
      status: ShipmentStatus.ASSIGNED,
      carrierId,
      inputOverrides: {
        senderId: userX,
        pickupDate: new Date("2030-01-03T00:00:00.000Z"),
        pickupTimeWindowStart: new Date("1970-01-01T18:00:00.000Z"),
      },
    });
    const sameDayEarly = await createActiveShipment({
      status: ShipmentStatus.ASSIGNED,
      carrierId,
      inputOverrides: {
        senderId: userX,
        pickupDate: new Date("2030-01-03T00:00:00.000Z"),
        pickupTimeWindowStart: new Date("1970-01-01T08:00:00.000Z"),
      },
    });

    const response = await request("/shipments/sending", userX);
    expect(response.json().map((item: { id: string }) => item.id)).toEqual([sameDayEarly, sameDayLate, later]);
  });

  it("AC6: isToday es true solo cuando pickupDate cae hoy en la zona horaria argentina", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T15:00:00.000Z")); // 12:00 ARG del 10/9

    const today = await createActiveShipment({
      status: ShipmentStatus.ASSIGNED,
      carrierId,
      inputOverrides: { senderId: userX, pickupDate: new Date("2026-09-10T00:00:00.000Z") },
    });
    const otherDay = await createActiveShipment({
      status: ShipmentStatus.ASSIGNED,
      carrierId,
      inputOverrides: { senderId: userX, pickupDate: new Date("2026-09-11T00:00:00.000Z") },
    });

    const response = await request("/shipments/sending", userX);
    const byId: Record<string, { isToday: boolean }> = Object.fromEntries(
      response.json().map((item: { id: string; isToday: boolean }) => [item.id, item])
    );

    expect(byId[today]!.isToday).toBe(true);
    expect(byId[otherDay]!.isToday).toBe(false);
  });

  it("AC6: pickupWindowExpired es true en assigned con ventana vencida, y siempre false en in_transit aunque la ventana ya haya pasado", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T15:00:00.000Z"));

    const overdueAssigned = await createActiveShipment({
      status: ShipmentStatus.ASSIGNED,
      carrierId,
      inputOverrides: {
        senderId: userX,
        pickupDate: new Date("2026-09-01T00:00:00.000Z"),
        pickupTimeWindowEnd: new Date("1970-01-01T22:00:00.000Z"),
      },
    });
    const overdueInTransit = await createActiveShipment({
      status: ShipmentStatus.IN_TRANSIT,
      carrierId,
      inputOverrides: {
        senderId: userX,
        pickupDate: new Date("2026-09-01T00:00:00.000Z"),
        pickupTimeWindowEnd: new Date("1970-01-01T22:00:00.000Z"),
      },
    });
    const futureAssigned = await createActiveShipment({
      status: ShipmentStatus.ASSIGNED,
      carrierId,
      inputOverrides: { senderId: userX, pickupDate: new Date("2026-09-20T00:00:00.000Z") },
    });

    const response = await request("/shipments/sending", userX);
    const byId: Record<string, { pickupWindowExpired: boolean }> = Object.fromEntries(
      response.json().map((item: { id: string; pickupWindowExpired: boolean }) => [item.id, item])
    );

    expect(byId[overdueAssigned]!.pickupWindowExpired).toBe(true);
    expect(byId[overdueInTransit]!.pickupWindowExpired).toBe(false);
    expect(byId[futureAssigned]!.pickupWindowExpired).toBe(false);
  });

  it("AC5: el DTO de resumen no expone senderId/receiverId/carrierId crudos", async () => {
    await createActiveShipment({ status: ShipmentStatus.ASSIGNED, carrierId, inputOverrides: { senderId: userX } });

    const response = await request("/shipments/sending", userX);
    const item = response.json()[0];
    expect(item.senderId).toBeUndefined();
    expect(item.receiverId).toBeUndefined();
    expect(item.carrierId).toBeUndefined();
    expect(item).toMatchObject({
      pickupAddress: expect.any(String),
      deliveryAddress: expect.any(String),
      agreedPriceArs: null,
    });
  });
});
