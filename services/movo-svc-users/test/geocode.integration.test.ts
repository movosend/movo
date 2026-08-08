import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { GeocodingProvider } from "../src/adapters/geocoding-provider";

describe("POST /geocode", () => {
  let app: FastifyInstance;

  const validBody = {
    street: "Av. Colón",
    number: "1234",
    city: "Córdoba",
    province: "Córdoba",
    zip: "5000",
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo_local_pw@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("geocodifica una dirección válida (mock provider, default sin credenciales) y devuelve lat/long/formattedAddress", async () => {
    const response = await app.inject({ method: "POST", url: "/geocode", payload: validBody });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { lat: number; long: number; formattedAddress: string };
    expect(typeof body.lat).toBe("number");
    expect(typeof body.long).toBe("number");
    expect(body.formattedAddress).toContain("Av. Colón");
  });

  it("es determinístico: la misma dirección siempre da el mismo lat/long (mock provider)", async () => {
    const first = await app.inject({ method: "POST", url: "/geocode", payload: validBody });
    const second = await app.inject({ method: "POST", url: "/geocode", payload: validBody });

    expect(JSON.parse(first.body)).toEqual(JSON.parse(second.body));
  });

  it("rechaza un body sin los campos requeridos con 400 VALIDATION_FAILED", async () => {
    const response = await app.inject({ method: "POST", url: "/geocode", payload: { street: "Av. Colón" } });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error.code).toBe("VALIDATION_FAILED");
  });

  it("propaga un GeocodingProvider inyectado (override de test) sin depender de credenciales reales de Google", async () => {
    const fakeProvider: GeocodingProvider = {
      async geocode() {
        return { lat: 1, long: 2, formattedAddress: "Fake address" };
      },
    };
    const appWithFake = buildApp({ geocodingProvider: fakeProvider });
    await appWithFake.ready();

    const response = await appWithFake.inject({ method: "POST", url: "/geocode", payload: validBody });
    expect(JSON.parse(response.body)).toEqual({ lat: 1, long: 2, formattedAddress: "Fake address" });

    await appWithFake.close();
  });
});
