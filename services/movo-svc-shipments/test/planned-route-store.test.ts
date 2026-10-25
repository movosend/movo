import { describe, it, expect } from "vitest";
import { createPlannedRouteStore } from "../src/modules/admin-internal/planned-route-store";
import { createFakeRoutesProvider } from "./fake-routes-provider";

// MOVO-327: la ruta del mapa del panel es accesoria; si el proveedor o Redis fallan, el seguimiento sale igual.
const route = { polyline: "abc", distanceMeters: 1000, durationSeconds: 60 };
const A = { lat: -31.4, lng: -64.2 };
const B = { lat: -32.4, lng: -63.2 };

function memoryRedis(initial: Record<string, string> = {}, opts: { failSet?: boolean; failGet?: boolean } = {}) {
  const store = new Map(Object.entries(initial));
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

describe("planned-route-store", () => {
  it("si el proveedor falla devuelve `null`, no cachea la ruta y no reintenta durante el cooldown", async () => {
    let calls = 0;
    const redis = memoryRedis();
    const store = createPlannedRouteStore({
      redis,
      provider: "google",
      routesProvider: createFakeRoutesProvider(route, {
        async getRoute() {
          calls++;
          throw new Error("quota");
        },
      }),
    });

    expect(await store.get("s1", A, B)).toBeNull();
    expect(await store.get("s1", A, B)).toBeNull();
    expect(calls).toBe(1);
    expect([...redis.store.keys()].every((k) => k.endsWith(":failed"))).toBe(true);
  });

  it("si Redis falla al leer la trata como miss y pide la ruta igual", async () => {
    const store = createPlannedRouteStore({ redis: memoryRedis({}, { failGet: true }), provider: "google", routesProvider: createFakeRoutesProvider(route) });
    expect(await store.get("s1", A, B)).toEqual(route);
  });

  it("si no puede guardar en Redis devuelve la ruta igual", async () => {
    const store = createPlannedRouteStore({ redis: memoryRedis({}, { failSet: true }), provider: "google", routesProvider: createFakeRoutesProvider(route) });
    expect(await store.get("s1", A, B)).toEqual(route);
  });

  it("un valor corrupto en la cache se vuelve a pedir", async () => {
    let calls = 0;
    const redis = memoryRedis();
    const provider = createFakeRoutesProvider(route, {
      async getRoute() {
        calls++;
        return route;
      },
    });
    const store = createPlannedRouteStore({ redis, provider: "google", routesProvider: provider });
    await store.get("s1", A, B);
    const [key] = [...redis.store.keys()];
    redis.store.set(key, "{no es json");

    expect(await store.get("s1", A, B)).toEqual(route);
    expect(calls).toBe(2);
  });

  it("dos pedidos simultáneos del mismo envío comparten la llamada", async () => {
    let calls = 0;
    const store = createPlannedRouteStore({
      redis: memoryRedis(),
      provider: "google",
      routesProvider: createFakeRoutesProvider(route, {
        async getRoute() {
          calls++;
          return route;
        },
      }),
    });

    await Promise.all([store.get("s1", A, B), store.get("s1", A, B)]);
    expect(calls).toBe(1);
  });
});
