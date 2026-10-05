import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRouteGameMatrixStore, unroutablePairs } from "../src/modules/demo/route-game-matrix-store";
import { ROUTE_GAME_SCENARIOS } from "../src/modules/demo/route-game.scenarios";

const scenario = ROUTE_GAME_SCENARIOS[1];
const n = scenario.pool.length;
const square = (v: number) => Array.from({ length: n }, () => Array.from({ length: n }, () => v));

function fakeRedis() {
  const data = new Map<string, string>();
  return {
    data,
    get: vi.fn(async (k: string) => data.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => {
      data.set(k, v);
      return "OK" as const;
    }),
  };
}

describe("route-game-matrix-store", () => {
  let redis: ReturnType<typeof fakeRedis>;
  const routeMatrix = vi.fn();

  beforeEach(() => {
    redis = fakeRedis();
    routeMatrix.mockReset();
    routeMatrix.mockResolvedValue({ distKm: square(1), timeMin: square(2), provider: "google_routes", elementsBilled: n * n });
  });

  const store = () =>
    createRouteGameMatrixStore({ redis: redis as never, pricingLogisticsClient: { routeMatrix } });

  it("la primera vez pide la matriz del pool completo y la cachea; después es hit sin costo", async () => {
    const s = store();
    const first = await s.get(scenario);
    expect(first.info).toEqual({ cache: "miss", provider: "google_routes", elementsBilled: n * n });
    expect(routeMatrix).toHaveBeenCalledWith({ points: scenario.pool.map(([, , lat, lng]) => ({ lat, lng })) });
    expect(redis.set).toHaveBeenCalledWith(`route_game_matrix:${scenario.id}:v${scenario.version}`, expect.any(String), "EX", expect.any(Number));

    const second = await s.get(scenario);
    expect(second.info).toEqual({ cache: "hit", provider: "google_routes", elementsBilled: 0 });
    expect(second.matrix.distKm).toEqual(square(1));
    expect(routeMatrix).toHaveBeenCalledTimes(1);
  });

  it("dos partidas simultáneas de la misma ciudad comparten un solo pedido", async () => {
    const s = store();
    await Promise.all([s.get(scenario), s.get(scenario), s.get(scenario)]);
    expect(routeMatrix).toHaveBeenCalledTimes(1);
  });

  it("no cachea la matriz del mock (gratis, y no debe sobrevivir al pasar a Google)", async () => {
    routeMatrix.mockResolvedValue({ distKm: square(1), timeMin: square(2), provider: "haversine_mock", elementsBilled: 0 });
    const s = store();
    await s.get(scenario);
    expect(redis.set).not.toHaveBeenCalled();
    expect((await s.get(scenario)).info.cache).toBe("miss");
  });

  it("una cache corrupta o de otro tamaño se vuelve a pedir", async () => {
    redis.data.set(`route_game_matrix:${scenario.id}:v${scenario.version}`, "{no es json");
    expect((await store().get(scenario)).info.cache).toBe("miss");
    redis.data.set(`route_game_matrix:${scenario.id}:v${scenario.version}`, JSON.stringify({ distKm: [[0]], timeMin: [[0]], provider: "google_routes" }));
    expect((await store().get(scenario)).info.cache).toBe("miss");
  });

  it("si pricing falla no guarda nada y propaga el error", async () => {
    routeMatrix.mockRejectedValue(new Error("caído"));
    await expect(store().get(scenario)).rejects.toThrow("caído");
    expect(redis.set).not.toHaveBeenCalled();
  });

  it("una matriz con un par no ruteable (0 fuera de la diagonal) no se cachea ni se juega", async () => {
    const withHole = square(1).map((row, i) => row.map((v, j) => (i === j ? 0 : v)));
    withHole[0][2] = 0;
    routeMatrix.mockResolvedValue({ distKm: withHole, timeMin: square(2), provider: "google_routes", elementsBilled: n * n });
    await expect(store().get(scenario)).rejects.toMatchObject({ statusCode: 503, code: "ROUTING_SERVICE_UNAVAILABLE" });
    expect(redis.set).not.toHaveBeenCalled();
  });

  it("una matriz con agujeros que ya estaba en cache se descarta y se vuelve a pedir", async () => {
    const withHole = square(1);
    withHole[1][0] = 0;
    redis.data.set(
      `route_game_matrix:${scenario.id}:v${scenario.version}`,
      JSON.stringify({ distKm: withHole, timeMin: square(2), provider: "google_routes" })
    );
    expect((await store().get(scenario)).info.cache).toBe("miss");
  });

  it("unroutablePairs ignora la diagonal", () => {
    expect(unroutablePairs([[0, 1], [2, 0]])).toEqual([]);
    expect(unroutablePairs([[0, 0], [2, 0]])).toEqual([[0, 1]]);
  });
});
