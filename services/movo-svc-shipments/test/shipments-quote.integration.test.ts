import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { PriceCalculationMethod } from "@movo/shared";
import { buildApp } from "../src/app";
import { SHIPMENT_QUOTE_TTL_SECONDS } from "../src/modules/shipments/quote-store";
import { createFakeUsersClient, fakePublicProfile } from "./fake-users-client";
import { createFakePricingClient } from "./fake-pricing-client";

/**
 * MOVO-255 (ADR-028): cotización congelada del resumen del wizard, contra Postgres y
 * Redis reales. El precio de pricing se cambia entre la cotización y la creación para
 * probar que el envío se crea con el precio cotizado y no con el nuevo (AC2).
 */
describe("POST /shipments/quote + POST /shipments con quoteId (Postgres + Redis)", () => {
  let app: FastifyInstance;
  const senderId = randomUUID();
  const otherSenderId = randomUUID();
  const receiverId = randomUUID();
  const pricingClient = createFakePricingClient();

  const quoteBody = {
    packageType: "standard_package",
    weightKg: 3,
    lengthCm: 30,
    widthCm: 20,
    heightCm: 15,
    pickupLat: -31.4201,
    pickupLng: -64.1888,
    deliveryLat: -32.4104,
    deliveryLng: -63.2404,
  };

  const createBody = {
    ...quoteBody,
    description: "Caja con libros",
    receiverId,
    pickupAddress: "Av. Colón 1234, Córdoba",
    deliveryAddress: "Bv. España 200, Villa María",
    pickupDate: "2030-01-01",
    pickupTimeWindowStart: "09:00",
    pickupTimeWindowEnd: "12:00",
  };

  async function quote(userId = senderId, body: Record<string, unknown> = quoteBody) {
    return app.inject({ method: "POST", url: "/shipments/quote", headers: { "x-user-id": userId }, payload: body });
  }

  async function create(quoteId: string | undefined, userId = senderId, body: Record<string, unknown> = createBody) {
    return app.inject({
      method: "POST",
      url: "/shipments",
      headers: { "x-user-id": userId },
      payload: quoteId === undefined ? body : { ...body, quoteId },
    });
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

    const usersClient = createFakeUsersClient({
      [receiverId]: fakePublicProfile({ id: receiverId, isVerified: true }),
    });
    app = buildApp({ usersClient, notificationsClient: { sendPush: vi.fn() }, pricingClient, sweepEnabled: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.shipments RESTART IDENTITY CASCADE");
    vi.mocked(pricingClient.getQuote).mockClear();
    vi.mocked(pricingClient.getQuote).mockResolvedValue({
      suggestedPriceArs: 30120,
      calculationMethod: PriceCalculationMethod.DEMAND_FUEL_ROUTES_V1,
      highDemand: true,
    });
  });

  it("cotiza con la misma lógica que la creación y congela el precio en Redis por 15 min", async () => {
    const response = await quote();

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      suggestedPriceArs: 30120,
      highDemand: true,
      calculationMethod: "demand_fuel_routes_v1",
    });
    expect(body.quoteId).toEqual(expect.any(String));
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    // Cuenta la demanda igual que `createShipment` (quoteShipment compartida).
    expect(pricingClient.getQuote).toHaveBeenCalledWith(
      expect.objectContaining({ originLat: quoteBody.pickupLat, demandContext: expect.any(Object) })
    );

    const ttl = await app.redis.ttl(`shipment_quote:${body.quoteId}`);
    expect(ttl).toBeGreaterThan(SHIPMENT_QUOTE_TTL_SECONDS - 10);
    expect(ttl).toBeLessThanOrEqual(SHIPMENT_QUOTE_TTL_SECONDS);
  });

  it("AC1/AC2: crea el envío con el precio cotizado aunque pricing cambie entre medio, sin volver a cotizar", async () => {
    const { quoteId } = (await quote()).json();

    vi.mocked(pricingClient.getQuote).mockClear();
    vi.mocked(pricingClient.getQuote).mockResolvedValue({
      suggestedPriceArs: 36000,
      calculationMethod: PriceCalculationMethod.DEMAND_FUEL_ROUTES_V1,
      highDemand: false,
    });

    const response = await create(quoteId);

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      suggestedPriceArs: 30120,
      highDemand: true,
      calculationMethod: "demand_fuel_routes_v1",
    });
    expect(pricingClient.getQuote).not.toHaveBeenCalled();
  });

  it("AC3: un quoteId no se puede usar dos veces", async () => {
    const { quoteId } = (await quote()).json();

    expect((await create(quoteId)).statusCode).toBe(201);
    const second = await create(quoteId);

    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("QUOTE_EXPIRED");
  });

  it("AC3: otro usuario no puede usar el quoteId, y el intento no lo quema para el dueño", async () => {
    const { quoteId } = (await quote()).json();

    const stolen = await create(quoteId, otherSenderId);
    expect(stolen.statusCode).toBe(409);
    expect(stolen.json().error.code).toBe("QUOTE_EXPIRED");

    const owner = await create(quoteId);
    expect(owner.statusCode).toBe(201);
    expect(owner.json().suggestedPriceArs).toBe(30120);
  });

  it("AC3: con datos distintos a los cotizados responde 409 QUOTE_MISMATCH y no crea el envío", async () => {
    const { quoteId } = (await quote()).json();

    const response = await create(quoteId, senderId, { ...createBody, weightKg: 10 });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("QUOTE_MISMATCH");
    expect(await app.db.shipment.count()).toBe(0);
  });

  it("los datos que no afectan el precio (descripción, dirección escrita, franja) no invalidan la cotización", async () => {
    const { quoteId } = (await quote()).json();

    const response = await create(quoteId, senderId, {
      ...createBody,
      description: "Otra descripción",
      pickupAddress: "Otra forma de escribir la dirección",
      pickupTimeWindowStart: "10:00",
    });

    expect(response.statusCode).toBe(201);
  });

  it("una cotización vencida responde 409 QUOTE_EXPIRED y no crea el envío", async () => {
    const { quoteId } = (await quote()).json();
    await app.redis.pexpire(`shipment_quote:${quoteId}`, 1);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const response = await create(quoteId);

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("QUOTE_EXPIRED");
    expect(await app.db.shipment.count()).toBe(0);
  });

  it("un quoteId inexistente responde 409 QUOTE_EXPIRED", async () => {
    const response = await create(randomUUID());

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("QUOTE_EXPIRED");
  });

  it("un 422 de validación del envío no quema la cotización", async () => {
    const { quoteId } = (await quote()).json();

    const invalid = await create(quoteId, senderId, { ...createBody, receiverId: senderId });
    expect(invalid.statusCode).toBe(422);

    expect((await create(quoteId)).statusCode).toBe(201);
  });

  it("si pricing no responde, devuelve 'precio a estimar' sin quoteId y no guarda nada", async () => {
    vi.mocked(pricingClient.getQuote).mockResolvedValue({
      suggestedPriceArs: null,
      calculationMethod: null,
      highDemand: null,
    });
    const keysBefore = await app.redis.keys("shipment_quote:*");

    const response = await quote();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      quoteId: null,
      suggestedPriceArs: null,
      highDemand: null,
      calculationMethod: null,
      expiresAt: null,
    });
    expect(await app.redis.keys("shipment_quote:*")).toHaveLength(keysBefore.length);
  });

  it("AC5: sin quoteId el envío se sigue creando y cotizando al crear", async () => {
    const response = await create(undefined);

    expect(response.statusCode).toBe(201);
    expect(response.json().suggestedPriceArs).toBe(30120);
    expect(pricingClient.getQuote).toHaveBeenCalledTimes(1);
  });

  it("valida el body de la cotización igual que el de la creación", async () => {
    const response = await quote(senderId, { ...quoteBody, weightKg: 999 });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_FAILED");
  });

  it("rechaza cotizar con retiro y entrega en la misma ubicación", async () => {
    const response = await quote(senderId, {
      ...quoteBody,
      deliveryLat: quoteBody.pickupLat,
      deliveryLng: quoteBody.pickupLng,
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("SHIPMENT_PICKUP_DELIVERY_TOO_CLOSE");
  });

  it("responde 401 sin x-user-id", async () => {
    const response = await app.inject({ method: "POST", url: "/shipments/quote", payload: quoteBody });
    expect(response.statusCode).toBe(401);
  });
});
