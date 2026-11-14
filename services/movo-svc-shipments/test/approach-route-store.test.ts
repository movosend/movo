import { describe, it, expect } from "vitest";
import {
  createApproachRouteStore,
  APPROACH_ROUTE_BUDGET_MAX,
  APPROACH_ROUTE_TTL_SECONDS,
} from "../src/modules/admin-internal/approach-route-store";
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
    async incr(key: string) {
      const next = Number(store.get(key)?.value ?? 0) + 1;
      store.set(key, { value: String(next), ttl: store.get(key)?.ttl });
      return next;
    },
    async expire(key: string, ttl: number) {
      const current = store.get(key);
      if (!current) return 0;
      store.set(key, { ...current, ttl });
      return 1;
    },
  };
}

function build(opts: { warn?: string[] } = {}) {
  let calls = 0;
  const redis = memoryRedis();
  const warn = opts.warn;
  const store = createApproachRouteStore({
    redis,
    provider: "google",
    ...(warn ? { logger: { warn: ((_o: unknown, m: string) => warn.push(m)) as never } } : {}),
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
    const routeKeys = [...redis.store.keys()].filter((k) => !/^approach_route:(budget|last):/.test(k));
    expect(routeKeys).toHaveLength(2);
    expect(routeKeys.every((k) => k.startsWith("approach_route:google:"))).toBe(true);
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
    const routeKey = [...redis.store.keys()].find((k) => k.startsWith("approach_route:google:"));
    expect(redis.store.get(routeKey!)?.ttl).toBe(APPROACH_ROUTE_TTL_SECONDS);
  });

  // Review PR-340: el tope por envío no depende del cliente ni de cuántos teléfonos tengan la pantalla abierta.
  describe("tope de llamadas por envío", () => {
    const cell = (i: number) => ({ lat: -31.45 - i * 0.01, lng: -64.19 });

    it(`pasadas ${APPROACH_ROUTE_BUDGET_MAX} llamadas en la ventana no llama más y devuelve la última ruta del envío`, async () => {
      const warn: string[] = [];
      const { store, calls } = build({ warn });
      for (let i = 0; i < APPROACH_ROUTE_BUDGET_MAX; i++) await store.get("s1", cell(i), PICKUP);
      expect(calls()).toBe(APPROACH_ROUTE_BUDGET_MAX);

      const over = await store.get("s1", cell(APPROACH_ROUTE_BUDGET_MAX), PICKUP);
      expect(calls()).toBe(APPROACH_ROUTE_BUDGET_MAX);
      expect(over).toEqual(route);
      expect(warn).toEqual(["approach_route_budget_exceeded"]);
    });

    it("una celda ya cacheada no gasta tope", async () => {
      const { store, redis, calls } = build();
      for (let i = 0; i < 3; i++) await store.get("s1", cell(0), PICKUP);
      expect(calls()).toBe(1);
      const budgetKey = [...redis.store.keys()].find((k) => k.startsWith("approach_route:budget:s1:"));
      expect(redis.store.get(budgetKey!)?.value).toBe("1");
    });

    it("el contador es por envío y vence con la ventana", async () => {
      const { store, redis, calls } = build();
      for (let i = 0; i <= APPROACH_ROUTE_BUDGET_MAX; i++) await store.get("s1", cell(i), PICKUP);
      await store.get("s2", cell(0), PICKUP);
      expect(calls()).toBe(APPROACH_ROUTE_BUDGET_MAX + 1);
      const budgetKey = [...redis.store.keys()].find((k) => k.startsWith("approach_route:budget:s1:"));
      expect(redis.store.get(budgetKey!)?.ttl).toBe(10 * 60);
    });

    it("pasado el tope y sin ninguna ruta previa, `null`", async () => {
      const { store, redis } = build();
      for (let i = 0; i < APPROACH_ROUTE_BUDGET_MAX; i++) await store.get("s1", cell(i), PICKUP);
      for (const key of [...redis.store.keys()]) if (key.startsWith("approach_route:last:")) redis.store.delete(key);
      expect(await store.get("s1", cell(APPROACH_ROUTE_BUDGET_MAX), PICKUP)).toBeNull();
    });
  });
});
