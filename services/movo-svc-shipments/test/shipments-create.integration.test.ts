import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { ShipmentStatus } from "@movo/shared";
import { buildApp } from "../src/app";
import { createShipmentRepository } from "../src/repositories/shipment-repository";
import { createFakeUsersClient, fakePublicProfile } from "./fake-users-client";
import { createFakePricingClient } from "./fake-pricing-client";

describe("POST /shipments (Postgres)", () => {
  let app: FastifyInstance;
  const senderId = randomUUID();
  const receiverId = randomUUID();
  const unverifiedReceiverId = randomUUID();
  const sendPush = vi.fn().mockResolvedValue(undefined);
  const pricingClient = createFakePricingClient();

  const validBody = {
    packageType: "standard_package",
    weightKg: 2.5,
    lengthCm: 30,
    widthCm: 20,
    heightCm: 15,
    description: "Caja con libros",
    receiverId,
    pickupAddress: "Av. Colón 1234, Córdoba",
    pickupLat: -31.4201,
    pickupLng: -64.1888,
    deliveryAddress: "Bv. San Juan 500, Córdoba",
    deliveryLat: -31.4135,
    deliveryLng: -64.1811,
    pickupDate: "2030-01-01",
    pickupTimeWindowStart: "09:00",
    pickupTimeWindowEnd: "12:00",
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

    const usersClient = createFakeUsersClient({
      [receiverId]: fakePublicProfile({ id: receiverId, isVerified: true }),
      [unverifiedReceiverId]: fakePublicProfile({ id: unverifiedReceiverId, isVerified: false }),
    });
    app = buildApp({ usersClient, notificationsClient: { sendPush }, pricingClient, sweepEnabled: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments RESTART IDENTITY CASCADE");
    sendPush.mockClear();
    vi.mocked(pricingClient.getQuote).mockClear();
  });

  it("crea el envío en estado awaiting_receiver_confirmation y registra el evento inicial", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/shipments",
      headers: { "x-user-id": senderId },
      payload: validBody,
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.senderId).toBe(senderId);
    expect(body.receiverId).toBe(receiverId);
    expect(body.status).toBe(ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION);
    // Estos tres campos son valores de calendario/reloj de pared anclados a UTC —
    // deben salir tal cual se mandaron, sin correrse por el timezone del proceso que
    // sirve la respuesta (bug real encontrado corriendo el servicio con TZ=-03:00).
    expect(body.pickupDate).toBe("2030-01-01");
    expect(body.pickupTimeWindowStart).toBe("09:00:00");
    expect(body.pickupTimeWindowEnd).toBe("12:00:00");
    expect(body.receiverConfirmationDeadline).toBeTruthy();
    expect(new Date(body.receiverConfirmationDeadline).getTime()).toBeGreaterThan(Date.now());

    const repo = createShipmentRepository(app.db);
    const events = await repo.listEvents(body.id);
    expect(events).toHaveLength(1);
    expect(events[0].fromStatus).toBeNull();
    expect(events[0].toStatus).toBe(ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION);
    expect(events[0].actorId).toBe(senderId);
  });

  it("AC1 de MOVO-108: notifica al receptor tras crear el envío", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/shipments",
      headers: { "x-user-id": senderId },
      payload: validBody,
    });

    expect(response.statusCode).toBe(201);
    const shipmentId = response.json().id;
    expect(sendPush).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: receiverId,
        data: { type: "shipment", shipmentId },
      })
    );
  });

  it("AC5 de MOVO-108: un fallo del cliente de notificaciones no bloquea la creación del envío", async () => {
    sendPush.mockRejectedValueOnce(new Error("svc-users caído"));

    const response = await app.inject({
      method: "POST",
      url: "/shipments",
      headers: { "x-user-id": senderId },
      payload: validBody,
    });

    expect(response.statusCode).toBe(201);
  });

  it("ignora un senderId falsificado en el body — usa siempre el del header", async () => {
    const impersonatedId = randomUUID();
    const response = await app.inject({
      method: "POST",
      url: "/shipments",
      headers: { "x-user-id": senderId },
      payload: { ...validBody, senderId: impersonatedId },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().senderId).toBe(senderId);
    expect(response.json().senderId).not.toBe(impersonatedId);
  });

  it("responde 401 sin x-user-id", async () => {
    const response = await app.inject({ method: "POST", url: "/shipments", payload: validBody });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("AUTH_TOKEN_INVALID");
  });

  it("responde 422 si el emisor se designa a sí mismo como receptor", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/shipments",
      headers: { "x-user-id": senderId },
      payload: { ...validBody, receiverId: senderId },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("SHIPMENT_RECEIVER_IS_SENDER");
  });

  it("responde 404 si el receptor no existe", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/shipments",
      headers: { "x-user-id": senderId },
      payload: { ...validBody, receiverId: randomUUID() },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("USER_NOT_FOUND");
  });

  it("responde 422 si el receptor no tiene KYC de identidad aprobado", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/shipments",
      headers: { "x-user-id": senderId },
      payload: { ...validBody, receiverId: unverifiedReceiverId },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("SHIPMENT_RECEIVER_KYC_NOT_APPROVED");
  });

  it("responde 422 si la franja de retiro está en el pasado", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/shipments",
      headers: { "x-user-id": senderId },
      payload: { ...validBody, pickupDate: "2020-01-01" },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("SHIPMENT_PICKUP_WINDOW_IN_PAST");
  });

  it("responde 400 si el peso excede el máximo permitido", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/shipments",
      headers: { "x-user-id": senderId },
      payload: { ...validBody, weightKg: 999 },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_FAILED");
  });

  it("AC6 de MOVO-82: si movo-svc-pricing-logistics falla, el envío se crea igual con 'precio a estimar'", async () => {
    vi.mocked(pricingClient.getQuote).mockResolvedValueOnce({
      suggestedPriceArs: null,
      calculationMethod: null,
    });

    const response = await app.inject({
      method: "POST",
      url: "/shipments",
      headers: { "x-user-id": senderId },
      payload: validBody,
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.suggestedPriceArs).toBeNull();
    expect(body.calculationMethod).toBeNull();
    expect(body.status).toBe(ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION);
  });

  it("con pricing disponible, persiste suggestedPriceArs y calculationMethod", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/shipments",
      headers: { "x-user-id": senderId },
      payload: validBody,
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.suggestedPriceArs).toBe(2256);
    expect(body.calculationMethod).toBe("euclidean_linear_v1");
  });
});
