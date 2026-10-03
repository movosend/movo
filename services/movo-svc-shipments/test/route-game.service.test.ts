import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiError } from "@movo/shared";
import { createRouteGameService, RouteGameSaveInput } from "../src/modules/demo/route-game.service";
import { RouteGameStore, StoredRouteGame } from "../src/modules/demo/route-game-store";
import { RouteGameMatrixStore } from "../src/modules/demo/route-game-matrix-store";
import { RouteGameRepository } from "../src/repositories/route-game-repository";
import { RouteGameSessionRecord } from "../src/models/route-game";
import { findScenario } from "../src/modules/demo/route-game.scenarios";
import { routeCost } from "../src/domain/route-game";
import { bruteForceOptimize, straightLineMatrix } from "./fake-route-game-optimizer";

const GAME_ID = "0f8d6a1c-2b3e-4c5d-8e9f-0a1b2c3d4e5f";

describe("route-game.service", () => {
  let games: Map<string, StoredRouteGame>;
  let saved: RouteGameSessionRecord[];
  const optimizeRoute = vi.fn(async (input) => bruteForceOptimize(input));
  const matrixGet = vi.fn<RouteGameMatrixStore["get"]>();
  const repository: { [K in keyof RouteGameRepository]: ReturnType<typeof vi.fn> } = {
    upsertSession: vi.fn(),
    listRanking: vi.fn(),
    hideFromRanking: vi.fn(),
  };

  const service = () =>
    createRouteGameService({
      pricingLogisticsClient: { optimizeRoute },
      matrixStore: { get: matrixGet },
      gameStore: {
        save: async (id, g) => void games.set(id, g),
        get: async (id) => games.get(id) ?? null,
      } satisfies RouteGameStore,
      repository: repository as unknown as RouteGameRepository,
      now: () => new Date("2026-10-10T18:00:00Z"),
    });

  beforeEach(() => {
    games = new Map();
    saved = [];
    optimizeRoute.mockClear();
    matrixGet.mockImplementation(async (scenario) => ({
      matrix: { ...straightLineMatrix(scenario.pool), provider: "google_routes" },
      info: { cache: "hit", provider: "google_routes", elementsBilled: 0 },
    }));
    repository.upsertSession.mockImplementation(async (r: RouteGameSessionRecord) => {
      const created = !saved.some((s) => s.id === r.id);
      saved = [...saved.filter((s) => s.id !== r.id), r];
      return { created };
    });
    repository.listRanking.mockResolvedValue([]);
    repository.hideFromRanking.mockResolvedValue(3);
  });

  describe("createGame", () => {
    it("arma la partida desde el pool, resuelve con objective distance sobre la submatriz y no revela el óptimo", async () => {
      const game = await service().createGame({ stopCount: 5 });
      const scenario = findScenario(game.scenarioId)!;
      const names = scenario.pool.map(([name]) => name);
      expect(game.stops).toHaveLength(5);
      expect(new Set([game.start.name, game.end.name, ...game.stops.map((s) => s.name)]).size).toBe(7);
      expect([game.start, game.end, ...game.stops].every((p) => names.includes(p.name))).toBe(true);
      expect(game).not.toHaveProperty("optimalOrder");
      expect(game.matrix).toEqual({ cache: "hit", provider: "google_routes", elementsBilled: 0 });

      const req = optimizeRoute.mock.calls[0][0];
      expect(req).toMatchObject({ objective: "distance", carrierLocation: { lat: game.start.lat, lng: game.start.lng } });
      expect(req.matrix.distKm).toHaveLength(7);
      expect(req.stops.every((s: { serviceTimeMinutes: number }) => s.serviceTimeMinutes === 0)).toBe(true);

      const stored = games.get(game.gameId)!;
      expect(stored.optimalKm).toBeCloseTo(routeCost(stored.matrix, stored.optimalOrder).km);
      expect(game.initialOrder.join()).not.toBe(stored.optimalOrder.join());
    });

    it("no repite la ciudad anterior del iPad", async () => {
      for (let i = 0; i < 20; i++) {
        expect((await service().createGame({ stopCount: 4, lastScenarioId: "caba" })).scenarioId).not.toBe("caba");
      }
    });

    it("503 si el optimizador devuelve una ruta incompleta", async () => {
      optimizeRoute.mockImplementationOnce(async (input) => ({ ...bruteForceOptimize(input), stops: [] }));
      await expect(service().createGame({ stopCount: 4 })).rejects.toMatchObject({ statusCode: 503 });
    });
  });

  describe("saveGame", () => {
    const base: RouteGameSaveInput = {
      eventTag: "feria-test",
      startedAt: "2026-10-10T17:58:00.000Z",
      endedAt: "2026-10-10T17:59:00.000Z",
      userOrder: [],
      timeUsedSec: 42,
      timeLimitSec: 60,
      timedOut: false,
    };

    it("mide la ruta del jugador con la matriz guardada, ignora números del cliente y guarda el resultado", async () => {
      const s = service();
      const game = await s.createGame({ stopCount: 4 });
      const stored = games.get(game.gameId)!;
      const userOrder = [...stored.optimalOrder].reverse();
      const res = await s.saveGame(game.gameId, { ...base, userOrder });
      const mine = routeCost(stored.matrix, userOrder);
      expect(res).toMatchObject({ created: true, computedBy: "server", optimalOrder: stored.optimalOrder });
      expect(res.userKm).toBeCloseTo(mine.km);
      expect(res.efficiencyPct).toBeCloseTo(Math.min(100, (stored.optimalKm / mine.km) * 100));
      expect(saved[0]).toMatchObject({ inRanking: false, name: null, email: null, stopCount: 4, timeLimitSec: 60 });
    });

    it("con nombre entra al ranking; el mail solo con consentimiento; reenviar es idempotente", async () => {
      const s = service();
      const game = await s.createGame({ stopCount: 4 });
      const userOrder = games.get(game.gameId)!.optimalOrder;
      await s.saveGame(game.gameId, { ...base, userOrder });
      const res = await s.saveGame(game.gameId, { ...base, userOrder, name: "  Juli ", email: "Juli@Mail.com", emailConsent: true });
      expect(res.created).toBe(false);
      expect(res.tie).toBe(true);
      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatchObject({ name: "Juli", inRanking: true, email: "juli@mail.com" });

      await s.saveGame(game.gameId, { ...base, userOrder, name: "Juli", email: "juli@mail.com" });
      expect(saved[0].email).toBeNull();
    });

    it("400 si el orden no es una permutación de las paradas de la partida", async () => {
      const s = service();
      const game = await s.createGame({ stopCount: 4 });
      await expect(s.saveGame(game.gameId, { ...base, userOrder: [0, 1, 2, 2] })).rejects.toBeInstanceOf(ApiError);
      await expect(s.saveGame(game.gameId, { ...base, userOrder: [0, 1, 2] })).rejects.toMatchObject({ statusCode: 400 });
    });

    it("partida vencida en Redis: usa los números offline del iPad (computedBy client)", async () => {
      const point = { name: "x", zone: "y", lat: -34.6, lng: -58.4 };
      const res = await service().saveGame(GAME_ID, {
        ...base,
        userOrder: [1, 0, 2, 3],
        offline: {
          scenarioId: "caba",
          city: "CABA",
          points: { start: point, stops: [point, point, point, point], end: point },
          optimalOrder: [0, 1, 2, 3],
          userKm: 10,
          optimalKm: 8,
          userMin: 30,
          optimalMin: 24,
          distanceMethod: "haversine_x1.35",
        },
      });
      expect(res).toMatchObject({ computedBy: "client", efficiencyPct: 80, extraKm: 2, distanceMethod: "haversine_x1.35" });
    });

    it("404 si la partida no existe y no vino offline; 400 si el offline es inválido", async () => {
      await expect(service().saveGame(GAME_ID, { ...base, userOrder: [0, 1, 2, 3] })).rejects.toMatchObject({
        statusCode: 404,
        code: "ROUTE_GAME_NOT_FOUND",
      });
      const point = { name: "x", zone: "y", lat: -34.6, lng: -58.4 };
      await expect(
        service().saveGame(GAME_ID, {
          ...base,
          userOrder: [0, 1, 2, 3],
          offline: {
            scenarioId: "caba",
            city: "CABA",
            points: { start: point, stops: [point, point, point, point], end: point },
            optimalOrder: [0, 0, 1, 2],
            userKm: 1,
            optimalKm: 1,
            userMin: 1,
            optimalMin: 1,
            distanceMethod: "x",
          },
        })
      ).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  it("ranking y reset leen desde el inicio del día en Argentina, con 'web' por default", async () => {
    await service().ranking(undefined, GAME_ID);
    expect(repository.listRanking).toHaveBeenCalledWith("web", new Date("2026-10-10T03:00:00Z"), expect.any(Number));
    expect(await service().resetRanking("feria-test")).toEqual({ hidden: 3 });
    expect(repository.hideFromRanking).toHaveBeenCalledWith("feria-test", new Date("2026-10-10T03:00:00Z"));
  });
});
