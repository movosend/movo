import Fastify, { FastifyInstance } from "fastify";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import errorHandlerPlugin from "../src/plugins/error-handler";
import demoRoutes from "../src/modules/demo/demo.routes";
import { PricingGameService } from "../src/modules/demo/pricing-game.service";
import { computePricingGameStats } from "../src/domain/pricing-game-stats";
import { RouteGameService } from "../src/modules/demo/route-game.service";

const SESSION_ID = "6f1c2a7e-0b55-4d3a-9b1e-2f7d8c9a0b11";
const DEMO = { "x-client-id": "demo-1" };

const quoteBody = {
  origin: { lat: -31.4201, lng: -64.1888 },
  destination: { lat: -32.9442, lng: -60.6505 },
  packagePreset: "small",
};

const sessionBody = {
  startedAt: "2026-10-10T15:00:00.000Z",
  endedAt: "2026-10-10T15:01:10.000Z",
  durationSec: 70,
  completed: true,
  lastScreen: "thanks",
  senderAnswer: "yes",
};

describe("rutas /demo/pricing-game (juego de precios)", () => {
  let app: FastifyInstance;
  let service: { [K in keyof PricingGameService]: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    service = {
      quote: vi.fn().mockResolvedValue({
        quoteId: "1b2c3d4e-5f60-4a1b-8c2d-3e4f5a6b7c8d",
        suggestedPriceArs: 62730,
        highDemand: false,
        calculationMethod: "demand_fuel_routes_v1",
        breakdown: null,
        commissionRate: 0.15,
        courierEarnArs: 54547.83,
      }),
      saveSession: vi.fn().mockResolvedValue({ id: SESSION_ID, created: true, quoteVerified: true }),
      stats: vi.fn().mockResolvedValue(computePricingGameStats([])),
    };
    app = Fastify({ logger: false });
    await app.register(errorHandlerPlugin);
    await app.register(demoRoutes, { prefix: "/demo", pricingGameService: service as unknown as PricingGameService });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it.each([
    ["POST", "/demo/pricing-game/quote", quoteBody],
    ["PUT", `/demo/pricing-game/sessions/${SESSION_ID}`, sessionBody],
    ["GET", "/demo/pricing-game/stats", undefined],
  ] as const)("401 en %s %s sin x-client-id del gateway", async (method, url, payload) => {
    const res = await app.inject({ method, url, ...(payload ? { payload } : {}) });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("AUTH_API_KEY_INVALID");
  });

  it("401 si x-client-id no es de un cliente demo", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/demo/pricing-game/quote",
      headers: { "x-client-id": "mobile" },
      payload: quoteBody,
    });
    expect(res.statusCode).toBe(401);
  });

  it("cotiza", async () => {
    const res = await app.inject({ method: "POST", url: "/demo/pricing-game/quote", headers: DEMO, payload: quoteBody });

    expect(res.statusCode).toBe(200);
    expect(res.json().suggestedPriceArs).toBe(62730);
    expect(service.quote).toHaveBeenCalledWith(quoteBody);
  });

  it.each([
    ["preset inexistente", { ...quoteBody, packagePreset: "piano" }],
    ["coordenadas fuera de Argentina", { ...quoteBody, origin: { lat: 40.4, lng: -3.7 } }],
  ])("400 con %s", async (_case, payload) => {
    const res = await app.inject({ method: "POST", url: "/demo/pricing-game/quote", headers: DEMO, payload });
    expect(res.statusCode).toBe(400);
    expect(service.quote).not.toHaveBeenCalled();
  });

  it("descarta campos extra: el peso lo define el preset, no el cliente", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/demo/pricing-game/quote",
      headers: DEMO,
      payload: { ...quoteBody, weightKg: 0.001 },
    });

    expect(res.statusCode).toBe(200);
    expect(service.quote).toHaveBeenCalledWith(quoteBody);
  });

  it("201 al crear la partida y 200 al reenviarla", async () => {
    const created = await app.inject({
      method: "PUT",
      url: `/demo/pricing-game/sessions/${SESSION_ID}`,
      headers: DEMO,
      payload: sessionBody,
    });
    service.saveSession.mockResolvedValueOnce({ id: SESSION_ID, created: false, quoteVerified: true });
    const resent = await app.inject({
      method: "PUT",
      url: `/demo/pricing-game/sessions/${SESSION_ID}`,
      headers: DEMO,
      payload: sessionBody,
    });

    expect(created.statusCode).toBe(201);
    expect(resent.statusCode).toBe(200);
    expect(service.saveSession).toHaveBeenCalledWith(SESSION_ID, sessionBody);
  });

  it("400 si el id de la partida no es UUID o la respuesta no es válida", async () => {
    const badId = await app.inject({ method: "PUT", url: "/demo/pricing-game/sessions/abc", headers: DEMO, payload: sessionBody });
    const badAnswer = await app.inject({
      method: "PUT",
      url: `/demo/pricing-game/sessions/${SESSION_ID}`,
      headers: DEMO,
      payload: { ...sessionBody, senderAnswer: "tal vez" },
    });

    expect(badId.statusCode).toBe(400);
    expect(badAnswer.statusCode).toBe(400);
  });

  it("stats filtra por eventTag y valida su formato", async () => {
    const ok = await app.inject({ method: "GET", url: "/demo/pricing-game/stats?eventTag=feria-utn-2026", headers: DEMO });
    const bad = await app.inject({ method: "GET", url: "/demo/pricing-game/stats?eventTag=DROP%20TABLE", headers: DEMO });

    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ sessions: 0, completionRate: null });
    expect(service.stats).toHaveBeenCalledWith("feria-utn-2026");
    expect(bad.statusCode).toBe(400);
  });
});

describe("rutas /demo/route-game (juego del optimizador)", () => {
  let app: FastifyInstance;
  let service: { [K in keyof RouteGameService]: ReturnType<typeof vi.fn> };
  const point = { name: "Obelisco", zone: "San Nicolás", lat: -34.6037, lng: -58.3816 };
  const saveBody = {
    startedAt: "2026-10-10T15:00:00.000Z",
    endedAt: "2026-10-10T15:01:00.000Z",
    userOrder: [2, 0, 1, 3],
    timeUsedSec: 41,
    timeLimitSec: 60,
    timedOut: false,
  };
  const saveResult = {
    id: SESSION_ID,
    created: true,
    computedBy: "server",
    userKm: 9.4,
    optimalKm: 8.1,
    userMin: 30,
    optimalMin: 26,
    extraKm: 1.3,
    extraMin: 4,
    efficiencyPct: 86.2,
    tie: false,
    optimalOrder: [0, 2, 1, 3],
    distanceMethod: "google_routes_vrptw_distance",
  };

  beforeEach(async () => {
    service = {
      createGame: vi.fn().mockResolvedValue({
        gameId: SESSION_ID,
        scenarioId: "caba",
        city: "CABA",
        zone: "Centro y Palermo",
        start: point,
        end: point,
        stops: [point, point, point, point],
        initialOrder: [3, 1, 0, 2],
        matrix: { cache: "hit", provider: "google_routes", elementsBilled: 0 },
      }),
      saveGame: vi.fn().mockResolvedValue(saveResult),
      ranking: vi.fn().mockResolvedValue({ total: 0, position: null, entries: [] }),
      resetRanking: vi.fn().mockResolvedValue({ hidden: 2 }),
    };
    app = Fastify({ logger: false });
    await app.register(errorHandlerPlugin);
    await app.register(demoRoutes, {
      prefix: "/demo",
      pricingGameService: {} as PricingGameService,
      routeGameService: service as unknown as RouteGameService,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it.each([
    ["POST", "/demo/route-game/games", { stopCount: 5 }],
    ["PUT", `/demo/route-game/games/${SESSION_ID}`, saveBody],
    ["GET", "/demo/route-game/ranking", undefined],
    ["POST", "/demo/route-game/ranking/reset", {}],
  ] as const)("401 en %s %s sin x-client-id del gateway", async (method, url, payload) => {
    const res = await app.inject({ method, url, ...(payload ? { payload } : {}) });
    expect(res.statusCode).toBe(401);
  });

  it("crea la partida con el indicador de cache de la matriz", async () => {
    const res = await app.inject({ method: "POST", url: "/demo/route-game/games", headers: DEMO, payload: { stopCount: 5, lastScenarioId: "rosario" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().matrix).toEqual({ cache: "hit", provider: "google_routes", elementsBilled: 0 });
    expect(service.createGame).toHaveBeenCalledWith({ stopCount: 5, lastScenarioId: "rosario" });
  });

  it.each([3, 8])("400 con stopCount %i", async (stopCount) => {
    const res = await app.inject({ method: "POST", url: "/demo/route-game/games", headers: DEMO, payload: { stopCount } });
    expect(res.statusCode).toBe(400);
  });

  it("201 al registrar y 200 al reenviar", async () => {
    const created = await app.inject({ method: "PUT", url: `/demo/route-game/games/${SESSION_ID}`, headers: DEMO, payload: saveBody });
    service.saveGame.mockResolvedValueOnce({ ...saveResult, created: false });
    const resent = await app.inject({ method: "PUT", url: `/demo/route-game/games/${SESSION_ID}`, headers: DEMO, payload: { ...saveBody, name: "Juli" } });
    expect(created.statusCode).toBe(201);
    expect(created.json().optimalOrder).toEqual([0, 2, 1, 3]);
    expect(resent.statusCode).toBe(200);
  });

  it("400 si el nombre supera 18 caracteres o el orden trae un índice fuera de rango", async () => {
    const longName = await app.inject({ method: "PUT", url: `/demo/route-game/games/${SESSION_ID}`, headers: DEMO, payload: { ...saveBody, name: "x".repeat(19) } });
    const badOrder = await app.inject({ method: "PUT", url: `/demo/route-game/games/${SESSION_ID}`, headers: DEMO, payload: { ...saveBody, userOrder: [0, 1, 2, 9] } });
    expect(longName.statusCode).toBe(400);
    expect(badOrder.statusCode).toBe(400);
  });

  it("ranking y reset pasan el eventTag", async () => {
    const ranking = await app.inject({ method: "GET", url: `/demo/route-game/ranking?eventTag=feria-utn-2026&gameId=${SESSION_ID}`, headers: DEMO });
    const reset = await app.inject({ method: "POST", url: "/demo/route-game/ranking/reset", headers: DEMO, payload: { eventTag: "feria-utn-2026" } });
    expect(ranking.statusCode).toBe(200);
    expect(service.ranking).toHaveBeenCalledWith("feria-utn-2026", SESSION_ID);
    expect(reset.json()).toEqual({ hidden: 2 });
    expect(service.resetRanking).toHaveBeenCalledWith("feria-utn-2026");
  });
});
