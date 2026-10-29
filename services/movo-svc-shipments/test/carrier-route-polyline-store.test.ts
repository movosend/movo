import { describe, it, expect } from "vitest";
import { createCarrierRoutePolylineStore } from "../src/modules/shipments/carrier-route-polyline-store";
import { RouteInput } from "../src/adapters/routes-provider";
import { createFakeRoutesProvider } from "./fake-routes-provider";

// MOVO-346 (punto 14): el camino de "Mi ruta" es accesorio; si el proveedor o Redis fallan, la ruta sale igual.
const route = { polyline: "abc", distanceMeters: 1000, durationSeconds: 60 };
const ORIGIN = { lat: -31.4, lng: -64.2 };
const stop = (shipmentId: string, type: string, lat: number) => ({ shipmentId, type, lat, lng: -64.1 });
const STOPS = [stop("s1", "pickup", -31.41), stop("s1", "delivery", -31.42), stop("s2", "delivery", -31.43)];

function memoryRedis(opts: { failGet?: boolean; failSet?: boolean } = {}) {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string) {
      if (opts.failGet) throw new Error("redis caído");
      return store.get(key) ?? null;
    },
    async set(key: string, value: string) {
      if (opts.failSet) throw new Error("redis caído");
      store.set(key, value);
      return "OK" as const;
    },
  };
}

describe("carrier-route-polyline-store", () => {
  it("pide la ruta desde el transportista por las paradas en orden, con la última como destino", async () => {
    const calls: RouteInput[] = [];
    const store = createCarrierRoutePolylineStore({
      redis: memoryRedis(),
      provider: "google",
      routesProvider: createFakeRoutesProvider(route, {
        async getRoute(input) {
          calls.push(input);
          return route;
        },
      }),
    });

    expect(await store.get("c1", ORIGIN, STOPS)).toBe("abc");
    expect(calls[0]).toMatchObject({
      origin: ORIGIN,
      destination: { lat: -31.43, lng: -64.1 },
      intermediates: [
        { lat: -31.41, lng: -64.1 },
        { lat: -31.42, lng: -64.1 },
      ],
    });
  });

  it("cachea por orden de paradas: el mismo orden no vuelve a pedir, otro orden sí", async () => {
    let calls = 0;
    const store = createCarrierRoutePolylineStore({
      redis: memoryRedis(),
      provider: "google",
      routesProvider: createFakeRoutesProvider(route, {
        async getRoute() {
          calls++;
          return route;
        },
      }),
    });

    await store.get("c1", ORIGIN, STOPS);
    await store.get("c1", { lat: -31.0, lng: -64.0 }, STOPS);
    expect(calls).toBe(1);

    await store.get("c1", ORIGIN, STOPS.slice(1));
    expect(calls).toBe(2);
  });

  it("si el proveedor falla devuelve null y no reintenta durante el cooldown", async () => {
    let calls = 0;
    const store = createCarrierRoutePolylineStore({
      redis: memoryRedis(),
      provider: "google",
      routesProvider: createFakeRoutesProvider(route, {
        async getRoute() {
          calls++;
          throw new Error("quota");
        },
      }),
    });

    expect(await store.get("c1", ORIGIN, STOPS)).toBeNull();
    expect(await store.get("c1", ORIGIN, STOPS)).toBeNull();
    expect(calls).toBe(1);
  });

  it("con Redis caído pide al proveedor y devuelve el camino igual", async () => {
    const store = createCarrierRoutePolylineStore({
      redis: memoryRedis({ failGet: true, failSet: true }),
      provider: "google",
      routesProvider: createFakeRoutesProvider(route),
    });

    expect(await store.get("c1", ORIGIN, STOPS)).toBe("abc");
  });

  it("sin paradas no pide nada", async () => {
    const store = createCarrierRoutePolylineStore({
      redis: memoryRedis(),
      provider: "google",
      routesProvider: createFakeRoutesProvider(route, {
        async getRoute() {
          throw new Error("no debería llamarse");
        },
      }),
    });

    expect(await store.get("c1", ORIGIN, [])).toBeNull();
  });
});
