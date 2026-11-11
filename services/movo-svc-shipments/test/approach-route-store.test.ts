import { describe, it, expect } from "vitest";
import { createApproachRouteStore, APPROACH_ROUTE_TTL_SECONDS } from "../src/modules/admin-internal/approach-route-store";
import { createFakeRoutesProvider } from "./fake-routes-provider";

// MOVO-359: el origen de la ruta al retiro se mueve con el auto; la clave lo agrupa en celdas de ~110 m.
const route = { polyline: "abc", distanceMeters: 800, durationSeconds: 90 };
const PICKUP = { lat: -31.4, lng: -64.2 };

function memoryRedis() {
  const store = new Map<string, { value: string; ttl?: number }>();
  return {
    store,
    async get(key: string) {
      return store.get(key)?.value ?? null;
    },
    async set(key: string, value: string, _mode?: string, ttl?: number) {
      store.set(key, { value, ttl });
      return "OK" as const;
    },
  };
}

function build() {
  let calls = 0;
  const redis = memoryRedis();
  const store = createApproachRouteStore({
    redis,
    provider: "google",
    routesProvider: createFakeRoutesProvider(route, {
      async getRoute() {
        calls++;
        return route;
      },
    }),
  });
  return { store, redis, calls: () => calls };
}

describe("approach-route-store", () => {
  it("con el auto en la misma celda reusa la ruta, aunque su posición cambie unas decenas de metros", async () => {
    const { store, calls } = build();
    await store.get("s1", { lat: -31.4501, lng: -64.1901 }, PICKUP);
    await store.get("s1", { lat: -31.4504, lng: -64.1903 }, PICKUP);
    expect(calls()).toBe(1);
  });

  it("al pasar a otra celda pide una ruta nueva", async () => {
    const { store, calls } = build();
    await store.get("s1", { lat: -31.45, lng: -64.19 }, PICKUP);
    await store.get("s1", { lat: -31.47, lng: -64.19 }, PICKUP);
    expect(calls()).toBe(2);
  });

  it("no mezcla la ruta de un envío con la de otro, ni usa la clave de la ruta planificada", async () => {
    const { store, redis, calls } = build();
    await store.get("s1", { lat: -31.45, lng: -64.19 }, PICKUP);
    await store.get("s2", { lat: -31.45, lng: -64.19 }, PICKUP);
    expect(calls()).toBe(2);
    expect([...redis.store.keys()].every((k) => k.startsWith("approach_route:google:"))).toBe(true);
  });

  it("los logs llevan su propio tag y una línea por llamada real al proveedor", async () => {
    const info: string[] = [];
    const warn: string[] = [];
    const store = createApproachRouteStore({
      redis: memoryRedis(),
      provider: "google",
      logger: { info: ((_o: unknown, m: string) => info.push(m)) as never, warn: ((_o: unknown, m: string) => warn.push(m)) as never },
      routesProvider: createFakeRoutesProvider(route, {
        async getRoute() {
          throw new Error("boom");
        },
      }),
    });
    await store.get("s1", { lat: -31.45, lng: -64.19 }, PICKUP);
    expect(info).toEqual(["approach_route_provider_call"]);
    expect(warn).toEqual(["approach_route_unavailable"]);
  });

  it("la ruta vive 2 minutos, no las 6 horas de la planificada", async () => {
    const { store, redis } = build();
    await store.get("s1", { lat: -31.45, lng: -64.19 }, PICKUP);
    expect([...redis.store.values()][0].ttl).toBe(APPROACH_ROUTE_TTL_SECONDS);
  });
});
