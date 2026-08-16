import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { PlacesProvider, createPlacesProvider } from "../src/adapters/places-provider";

describe("POST /places/autocomplete y /places/details", () => {
  let app: FastifyInstance;

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

  it("devuelve predicciones para una búsqueda que matchea el mock provider", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/places/autocomplete",
      payload: { input: "Colón" },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { predictions: Array<{ placeId: string; description: string }> };
    expect(body.predictions.length).toBeGreaterThan(0);
    expect(body.predictions[0].description).toContain("Colón");
  });

  it("devuelve una lista vacía cuando no hay ninguna coincidencia (mock provider)", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/places/autocomplete",
      payload: { input: "xyzxyz-no-existe" },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ predictions: [] });
  });

  it("rechaza un input demasiado corto con 400 VALIDATION_FAILED", async () => {
    const response = await app.inject({ method: "POST", url: "/places/autocomplete", payload: { input: "a" } });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error.code).toBe("VALIDATION_FAILED");
  });

  it("devuelve las coordenadas de un placeId conocido (mock provider)", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/places/details",
      payload: { placeId: "mock-1" },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { formattedAddress: string; lat: number; long: number };
    expect(typeof body.lat).toBe("number");
    expect(typeof body.long).toBe("number");
    expect(body.formattedAddress).toContain("Colón");
  });

  it("devuelve 404 PLACE_NOT_FOUND para un placeId inexistente", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/places/details",
      payload: { placeId: "no-existe" },
    });

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body).error.code).toBe("PLACE_NOT_FOUND");
  });

  it("propaga un PlacesProvider inyectado (override de test) sin depender de credenciales reales de Google", async () => {
    const fakeProvider: PlacesProvider = {
      async autocomplete() {
        return [{ placeId: "fake-1", description: "Fake address" }];
      },
      async details() {
        return { formattedAddress: "Fake address", lat: 1, long: 2 };
      },
    };
    const appWithFake = buildApp({ placesProvider: fakeProvider });
    await appWithFake.ready();

    const response = await appWithFake.inject({
      method: "POST",
      url: "/places/autocomplete",
      payload: { input: "cualquier cosa" },
    });
    expect(JSON.parse(response.body)).toEqual({ predictions: [{ placeId: "fake-1", description: "Fake address" }] });

    await appWithFake.close();
  });

  it("createPlacesProvider tira si se pide PLACES_PROVIDER=google sin GOOGLE_MAPS_API_KEY", () => {
    expect(() => createPlacesProvider({ PLACES_PROVIDER: "google" })).toThrow(
      "PLACES_PROVIDER=google requiere GOOGLE_MAPS_API_KEY"
    );
  });
});
