import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { createFakeRoutesProvider } from "./fake-routes-provider";

describe("GET /shipments/route", () => {
  let app: FastifyInstance;
  const userId = randomUUID();

  const validQuery = {
    originLat: -31.4201,
    originLng: -64.1888,
    destinationLat: -31.4135,
    destinationLng: -64.1811,
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    app = buildApp({
      routesProvider: createFakeRoutesProvider({ polyline: "fakePolyline", distanceMeters: 1200, durationSeconds: 180 }),
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("devuelve el polyline, distancia y duración de la ruta (provider inyectado)", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/shipments/route",
      query: validQuery as unknown as Record<string, string>,
      headers: { "x-user-id": userId },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      polyline: "fakePolyline",
      distanceMeters: 1200,
      durationSeconds: 180,
    });
  });

  it("rechaza sin autenticación con 401", async () => {
    const response = await app.inject({ method: "GET", url: "/shipments/route", query: validQuery as unknown as Record<string, string> });
    expect(response.statusCode).toBe(401);
  });

  it("rechaza querystring incompleta con 400", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/shipments/route",
      query: { originLat: "-31.4201" },
      headers: { "x-user-id": userId },
    });
    expect(response.statusCode).toBe(400);
  });
});
