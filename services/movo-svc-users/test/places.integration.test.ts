import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { PlacesProvider, createPlacesProvider } from "../src/adapters/places-provider";
import { GeocodingProvider } from "../src/adapters/geocoding-provider";
import { ApiError } from "@movo/shared";

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

  describe("búsqueda por coordenadas (MOVO-340)", () => {
    const placesThatMustNotBeCalled: PlacesProvider = {
      async autocomplete() {
        throw new Error("no debería llamarse a Places con coordenadas");
      },
      async details() {
        throw new Error("no debería llamarse a Places con coordenadas");
      },
    };

    async function autocompleteWith(input: string, opts: Parameters<typeof buildApp>[0]) {
      const scoped = buildApp(opts);
      await scoped.ready();
      try {
        const response = await scoped.inject({ method: "POST", url: "/places/autocomplete", payload: { input } });
        return { statusCode: response.statusCode, body: JSON.parse(response.body) };
      } finally {
        await scoped.close();
      }
    }

    it("con el mock devuelve una sola sugerencia con la dirección y el punto que escribió el usuario", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/places/autocomplete",
        payload: { input: "-31.4201, -64.1888" },
      });

      expect(response.statusCode).toBe(200);
      const { predictions } = JSON.parse(response.body);
      expect(predictions).toHaveLength(1);
      expect(predictions[0]).toEqual({
        placeId: "coords:-31.4201,-64.1888",
        description: expect.stringContaining("Dirección simulada"),
        lat: -31.4201,
        long: -64.1888,
      });
    });

    it("no llama a Places y usa la dirección del reverse geocoding como etiqueta", async () => {
      const geocodingProvider: GeocodingProvider = {
        async geocode() {
          throw new Error("no se usa");
        },
        async reverseGeocode(lat, long) {
          expect({ lat, long }).toEqual({ lat: -31.420111, long: -64.188806 });
          return { formattedAddress: "Av. Colón 1234, Córdoba", city: "Córdoba" };
        },
      };

      const { statusCode, body } = await autocompleteWith(`31°25'12.4"S 64°11'19.7"W`, {
        placesProvider: placesThatMustNotBeCalled,
        geocodingProvider,
      });

      expect(statusCode).toBe(200);
      expect(body.predictions).toEqual([
        { placeId: "coords:-31.420111,-64.188806", description: "Av. Colón 1234, Córdoba", lat: -31.420111, long: -64.188806 },
      ]);
    });

    it("si el reverse geocoding no encuentra dirección, la sugerencia aparece igual con las coordenadas como etiqueta", async () => {
      const geocodingProvider: GeocodingProvider = {
        async geocode() {
          throw new Error("no se usa");
        },
        async reverseGeocode() {
          throw new ApiError(422, "GEOCODING_ADDRESS_NOT_FOUND", "sin dirección");
        },
      };

      const { statusCode, body } = await autocompleteWith("-31.4201 -64.1888", {
        placesProvider: placesThatMustNotBeCalled,
        geocodingProvider,
      });

      expect(statusCode).toBe(200);
      expect(body.predictions).toEqual([
        { placeId: "coords:-31.4201,-64.1888", description: "-31.4201, -64.1888", lat: -31.4201, long: -64.1888 },
      ]);
    });

    it("un input fuera de rango sigue el camino normal del autocompletado", async () => {
      const placesProvider: PlacesProvider = {
        async autocomplete(input) {
          return [{ placeId: "fake-1", description: `Resultado de Places para ${input}` }];
        },
        async details() {
          throw new Error("no se usa");
        },
      };

      const { body } = await autocompleteWith("-95.1, -64.1888", { placesProvider });

      expect(body.predictions).toEqual([{ placeId: "fake-1", description: "Resultado de Places para -95.1, -64.1888" }]);
    });
  });

  it("createPlacesProvider tira si se pide PLACES_PROVIDER=google sin GOOGLE_MAPS_API_KEY", () => {
    expect(() => createPlacesProvider({ PLACES_PROVIDER: "google" })).toThrow(
      "PLACES_PROVIDER=google requiere GOOGLE_MAPS_API_KEY"
    );
  });
});
