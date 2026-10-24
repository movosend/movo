import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { createShipmentRepository } from "../src/repositories/shipment-repository";
import { PackageType } from "../src/models/shipment";
import { backfillShipmentCities } from "../src/scripts/backfill-cities";
import { createFakeUsersClient } from "./fake-users-client";

describe("Backfill de ciudades (Postgres) — MOVO-325", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    app = buildApp({ usersClient: createFakeUsersClient({}) });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const create = (overrides: { pickupLat: number; pickupCity?: string | null }) =>
    createShipmentRepository(app.db).create({
      senderId: randomUUID(),
      receiverId: randomUUID(),
      packageType: PackageType.standard_package,
      weightKg: 1,
      lengthCm: 10,
      widthCm: 10,
      heightCm: 10,
      pickupAddress: "Calle 1",
      pickupLat: overrides.pickupLat,
      pickupLng: -64.1,
      deliveryAddress: "Calle 2",
      deliveryLat: -32.4,
      deliveryLng: -63.2,
      pickupDate: new Date("2030-01-01T00:00:00.000Z"),
      pickupTimeWindowStart: new Date("1970-01-01T09:00:00.000Z"),
      pickupTimeWindowEnd: new Date("1970-01-01T12:00:00.000Z"),
      suggestedPriceArs: null,
      calculationMethod: null,
      highDemand: null,
      ...(overrides.pickupCity !== undefined ? { pickupCity: overrides.pickupCity } : {}),
    });

  it("completa solo las ciudades que faltan, no pisa las que ya están y deja en NULL lo que no se pudo ubicar", async () => {
    const missing = await create({ pickupLat: -31.1111 });
    const complete = await create({ pickupLat: -31.2222, pickupCity: "Rosario" });
    const unknown = await create({ pickupLat: -31.3333 });
    await app.db.shipment.update({ where: { id: complete.id }, data: { deliveryCity: "Rosario" } });

    const asked: number[] = [];
    const usersClient = {
      async findCity(lat: number) {
        asked.push(lat);
        return lat === -31.3333 ? null : lat === -32.4 ? "Villa María" : "Córdoba";
      },
    };

    const result = await backfillShipmentCities(app.db, usersClient, { info: () => undefined });

    expect(result.updated).toBeGreaterThanOrEqual(1);
    expect(result.unresolved).toBeGreaterThanOrEqual(1);
    const rows = await app.db.shipment.findMany({ where: { id: { in: [missing.id, complete.id, unknown.id] } } });
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(missing.id)).toMatchObject({ pickupCity: "Córdoba", deliveryCity: "Villa María" });
    expect(byId.get(complete.id)).toMatchObject({ pickupCity: "Rosario", deliveryCity: "Rosario" });
    expect(byId.get(unknown.id)).toMatchObject({ pickupCity: null, deliveryCity: "Villa María" });
    // El envío completo no se consulta.
    expect(asked).not.toContain(-31.2222);

    // Idempotente: una segunda corrida no vuelve a tocar lo resuelto.
    await backfillShipmentCities(app.db, usersClient, { info: () => undefined });
    expect((await app.db.shipment.findUnique({ where: { id: missing.id } }))?.pickupCity).toBe("Córdoba");
  });
});
