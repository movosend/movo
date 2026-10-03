import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { createFakePricingLogisticsClient } from "./fake-pricing-logistics-client";
import { bruteForceOptimize, straightLineMatrix } from "./fake-route-game-optimizer";
import { findScenario, ROUTE_GAME_SCENARIOS } from "../src/modules/demo/route-game.scenarios";

/**
 * Juego del optimizador de punta a punta contra Postgres y Redis reales: la matriz de la
 * ciudad se pide una sola vez, la partida se mide con esa matriz, se registra sin duplicar
 * y el ranking del día es compartido entre partidas del mismo evento.
 */
describe("/demo/route-game (Postgres + Redis)", () => {
  let app: FastifyInstance;
  const DEMO = { "x-client-id": "demo-1" };
  const EVENT = "feria-route-test";
  const routeMatrix = vi.fn(async ({ points }: { points: { lat: number; lng: number }[] }) => {
    const scenario = ROUTE_GAME_SCENARIOS.find((s) => s.pool.length === points.length && s.pool[0][2] === points[0].lat)!;
    return { ...straightLineMatrix(scenario.pool), provider: "google_routes", elementsBilled: points.length ** 2 };
  });
  const pricingLogisticsClient = createFakePricingLogisticsClient({
    routeMatrix,
    optimizeRoute: vi.fn(async (input) => bruteForceOptimize(input)),
  });

  async function create(stopCount = 5, lastScenarioId?: string) {
    const res = await app.inject({ method: "POST", url: "/demo/route-game/games", headers: DEMO, payload: { stopCount, lastScenarioId } });
    expect(res.statusCode).toBe(200);
    return res.json();
  }

  function save(gameId: string, userOrder: number[], extra: Record<string, unknown> = {}) {
    const now = new Date();
    return app.inject({
      method: "PUT",
      url: `/demo/route-game/games/${gameId}`,
      headers: DEMO,
      payload: {
        eventTag: EVENT,
        startedAt: new Date(now.getTime() - 60_000).toISOString(),
        endedAt: now.toISOString(),
        userOrder,
        timeUsedSec: 40,
        timeLimitSec: 60,
        timedOut: false,
        ...extra,
      },
    });
  }

  /** El óptimo guardado en Redis al crear la partida (el cliente no lo ve hasta registrarla). */
  async function storedOptimalOrder(gameId: string): Promise<number[]> {
    const raw = await app.redis.get(`route_game:${gameId}`);
    return JSON.parse(raw!).optimalOrder;
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    app = buildApp({ notificationsClient: { sendPush: vi.fn() }, pricingLogisticsClient, sweepEnabled: false });
    await app.ready();
  });

  // Las matrices de este test son falsas (línea recta): no pueden quedar en el Redis
  // que comparte el stack local, donde el juego las serviría como si fueran de Google.
  async function clearMatrixCache() {
    const keys = await app.redis.keys("route_game_matrix:*");
    if (keys.length) await app.redis.del(...keys);
  }

  afterAll(async () => {
    await clearMatrixCache();
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.route_game_sessions");
    await clearMatrixCache();
    routeMatrix.mockClear();
  });

  it("la matriz de una ciudad se factura una sola vez: la segunda partida es hit", async () => {
    const first = await create(5);
    expect(first.matrix).toMatchObject({ cache: "miss", provider: "google_routes" });
    expect(first.matrix.elementsBilled).toBe(findScenario(first.scenarioId)!.pool.length ** 2);

    // Mismo iPad pidiendo otra vez sin `lastScenarioId`: hasta que salga la misma ciudad.
    let again = await create(5);
    while (again.scenarioId !== first.scenarioId) again = await create(5);
    expect(again.matrix).toEqual({ cache: "hit", provider: "google_routes", elementsBilled: 0 });
    const callsForCity = routeMatrix.mock.calls.filter(([{ points }]) => points[0].lat === findScenario(first.scenarioId)!.pool[0][2]);
    expect(callsForCity).toHaveLength(1);
  });

  it("registra la partida, la reenvía sin duplicar y la anota en el ranking con nombre", async () => {
    const game = await create(4);
    const first = await save(game.gameId, game.initialOrder);
    expect(first.statusCode).toBe(201);
    const result = first.json();
    expect(result.computedBy).toBe("server");
    expect(result.userKm).toBeGreaterThanOrEqual(result.optimalKm);

    const second = await save(game.gameId, game.initialOrder, { name: "Juli", email: "juli@mail.com", emailConsent: true });
    expect(second.statusCode).toBe(200);
    expect(second.json().efficiencyPct).toBe(result.efficiencyPct);

    const rows = await app.db.routeGameSession.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ eventTag: EVENT, name: "Juli", inRanking: true, email: "juli@mail.com", computedBy: "server", stopCount: 4 });

    const ranking = await app.inject({ method: "GET", url: `/demo/route-game/ranking?eventTag=${EVENT}&gameId=${game.gameId}`, headers: DEMO });
    expect(ranking.json()).toMatchObject({ total: 1, position: 1, entries: [{ name: "Juli", mine: true }] });
  });

  it("ranking compartido: ordena las partidas de distintos iPads; el reset las saca sin borrarlas", async () => {
    const perfect = await create(4);
    await save(perfect.gameId, await storedOptimalOrder(perfect.gameId), { name: "Ana", deviceId: "ipad-1" });

    const worse = await create(4);
    await save(worse.gameId, worse.initialOrder, { name: "Beto", deviceId: "ipad-2" });

    const otherEvent = await create(4);
    await save(otherEvent.gameId, otherEvent.initialOrder, { name: "Otro", eventTag: "otro-evento" });

    const ranking = (await app.inject({ method: "GET", url: `/demo/route-game/ranking?eventTag=${EVENT}`, headers: DEMO })).json();
    expect(ranking.entries.map((e: { name: string }) => e.name)).toEqual(["Ana", "Beto"]);
    expect(ranking.entries[0].efficiencyPct).toBe(100);

    const reset = await app.inject({ method: "POST", url: "/demo/route-game/ranking/reset", headers: DEMO, payload: { eventTag: EVENT } });
    expect(reset.json()).toEqual({ hidden: 2 });
    const after = (await app.inject({ method: "GET", url: `/demo/route-game/ranking?eventTag=${EVENT}`, headers: DEMO })).json();
    expect(after.total).toBe(0);
    expect(await app.db.routeGameSession.count()).toBe(3);
  });

  it("el segundo PUT no cambia el resultado: reenviar el óptimo con tiempo 0 no sube en el ranking", async () => {
    const game = await create(4);
    const first = (await save(game.gameId, game.initialOrder)).json();

    const cheat = await save(game.gameId, first.optimalOrder, { timeUsedSec: 0, name: "Tramposo" });
    expect(cheat.statusCode).toBe(200);
    expect(cheat.json()).toMatchObject({ efficiencyPct: first.efficiencyPct, userKm: first.userKm, tie: first.tie });

    const [row] = await app.db.routeGameSession.findMany();
    expect(row).toMatchObject({ name: "Tramposo", inRanking: true, timeUsedSec: 40, userOrder: game.initialOrder });
    expect(row.efficiencyPct.toNumber()).toBe(first.efficiencyPct);
  });

  it("un reenvío sin nombre (la cola manda tarde el primer PUT) no borra el nombre ni el mail", async () => {
    const game = await create(4);
    await save(game.gameId, game.initialOrder, { name: "Juli", email: "juli@mail.com", emailConsent: true });
    await save(game.gameId, game.initialOrder);
    const [row] = await app.db.routeGameSession.findMany();
    expect(row).toMatchObject({ name: "Juli", email: "juli@mail.com", inRanking: true });
  });

  it("después del reset, un reenvío no devuelve la partida al ranking (tampoco un 'anotarme' en vuelo)", async () => {
    const ranked = await create(4);
    await save(ranked.gameId, ranked.initialOrder, { name: "Ana" });
    const unnamed = await create(4);
    await save(unnamed.gameId, unnamed.initialOrder);

    const reset = await app.inject({ method: "POST", url: "/demo/route-game/ranking/reset", headers: DEMO, payload: { eventTag: EVENT } });
    expect(reset.json()).toEqual({ hidden: 1 });

    await save(ranked.gameId, ranked.initialOrder, { name: "Ana" });
    await save(unnamed.gameId, unnamed.initialOrder, { name: "Beto" });
    const after = (await app.inject({ method: "GET", url: `/demo/route-game/ranking?eventTag=${EVENT}`, headers: DEMO })).json();
    expect(after.total).toBe(0);

    // Una partida nueva después del reset sí entra.
    const fresh = await create(4);
    await save(fresh.gameId, fresh.initialOrder, { name: "Caro" });
    const ranking = (await app.inject({ method: "GET", url: `/demo/route-game/ranking?eventTag=${EVENT}`, headers: DEMO })).json();
    expect(ranking.entries.map((e: { name: string }) => e.name)).toEqual(["Caro"]);
  });

  it("partida jugada sin red: se guarda con los números del iPad", async () => {
    const id = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
    const point = { name: "Obelisco", zone: "San Nicolás", lat: -34.6037, lng: -58.3816 };
    const offline = {
      offline: {
        scenarioId: "caba",
        city: "CABA",
        points: { start: point, stops: [point, point, point, point], end: point },
        optimalOrder: [0, 1, 2, 3],
        userKm: 12.5,
        optimalKm: 10,
        userMin: 40,
        optimalMin: 32,
        distanceMethod: "haversine_x1.35",
      },
    };
    const res = await save(id, [1, 0, 2, 3], offline);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ computedBy: "client", efficiencyPct: 80 });
    // Con nombre igual queda fuera del ranking: los km los mandó el iPad.
    await save(id, [1, 0, 2, 3], { ...offline, name: "Offline" });
    expect(await app.db.routeGameSession.findUnique({ where: { id } })).toMatchObject({ name: "Offline", inRanking: false });
    const unknown = await save("8b1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", [0, 1, 2, 3]);
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.code).toBe("ROUTE_GAME_NOT_FOUND");
  });
});
