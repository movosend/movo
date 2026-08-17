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
      async reverseGeocode() {
        return { formattedAddress: "Fake reverse address" };
      },
    };
    const appWithFake = buildApp({ geocodingProvider: fakeProvider });
    await appWithFake.ready();

    const response = await appWithFake.inject({ method: "POST", url: "/geocode", payload: validBody });
    expect(JSON.parse(response.body)).toEqual({ lat: 1, long: 2, formattedAddress: "Fake address" });

    await appWithFake.close();
  });
});

describe("POST /geocode/reverse (MOVO-125)", () => {
  let app: FastifyInstance;
  const AUTH_HEADERS = { "x-user-id": "11111111-1111-1111-1111-111111111111" };

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

  it("rechaza sin x-user-id con 401 AUTH_TOKEN_INVALID — a diferencia de /geocode, esta ruta está protegida", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/geocode/reverse",
      payload: { lat: -31.4201, long: -64.1888 },
    });

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body).error.code).toBe("AUTH_TOKEN_INVALID");
  });

  it("resuelve una dirección legible a partir de lat/long (mock provider, autenticado)", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/geocode/reverse",
      headers: AUTH_HEADERS,
      payload: { lat: -31.4201, long: -64.1888 },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { formattedAddress: string };
    expect(typeof body.formattedAddress).toBe("string");
    expect(body.formattedAddress.length).toBeGreaterThan(0);
  });

  it("es determinístico: el mismo lat/long siempre da la misma dirección (mock provider)", async () => {
    const payload = { lat: -31.42, long: -64.19 };
    const first = await app.inject({ method: "POST", url: "/geocode/reverse", headers: AUTH_HEADERS, payload });
    const second = await app.inject({ method: "POST", url: "/geocode/reverse", headers: AUTH_HEADERS, payload });

    expect(JSON.parse(first.body)).toEqual(JSON.parse(second.body));
  });

  it("rechaza un body sin lat/long con 400 VALIDATION_FAILED", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/geocode/reverse",
      headers: AUTH_HEADERS,
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error.code).toBe("VALIDATION_FAILED");
  });

  it("propaga un GeocodingProvider inyectado (override de test) sin depender de credenciales reales de Google", async () => {
    const fakeProvider: GeocodingProvider = {
      async geocode() {
        return { lat: 1, long: 2, formattedAddress: "Fake address" };
      },
      async reverseGeocode() {
        return { formattedAddress: "Fake reverse address" };
      },
    };
    const appWithFake = buildApp({ geocodingProvider: fakeProvider });
    await appWithFake.ready();

    const response = await appWithFake.inject({
      method: "POST",
      url: "/geocode/reverse",
      headers: AUTH_HEADERS,
      payload: { lat: -31.4201, long: -64.1888 },
    });
    expect(JSON.parse(response.body)).toEqual({ formattedAddress: "Fake reverse address" });

    await appWithFake.close();
  });
});
