import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { PriceCalculationMethod } from "@movo/shared";
import { buildApp } from "../src/app";
import { createFakePricingClient } from "./fake-pricing-client";

/**
 * Juego de precios de la feria, de punta a punta contra Postgres y Redis reales:
 * cotizar, registrar la partida (con el precio tomado de Redis), reenviarla sin
 * duplicar y leer las métricas.
 */
describe("/demo/pricing-game (Postgres + Redis)", () => {
  let app: FastifyInstance;
  const pricingClient = createFakePricingClient();
  const DEMO = { "x-client-id": "demo-1" };

  const breakdown = {
    distanceKm: 401.2,
    distanceSource: "routes_api",
    fuelArsPerLiter: 2222.5,
    fuelSource: "api",
    perKmArs: 151.13,
    base: 1500.19,
    distance: 60633.36,
    weight: 600.08,
    packageFactor: 1,
    demandRatio: 0.5,
    demandMultiplier: 1,
  };

  async function quote() {
    const res = await app.inject({
      method: "POST",
      url: "/demo/pricing-game/quote",
      headers: DEMO,
      payload: {
        origin: { lat: -31.4201, lng: -64.1888 },
        destination: { lat: -32.9442, lng: -60.6505 },
        packagePreset: "small",
      },
    });
    expect(res.statusCode).toBe(200);
    return res.json();
  }

  function session(quoteId: string | null, overrides: Record<string, unknown> = {}) {
    return {
      eventTag: "feria-test",
      deviceId: "ipad-1",
      startedAt: "2026-10-10T15:00:00.000Z",
      endedAt: "2026-10-10T15:01:10.000Z",
      durationSec: 70,
      completed: true,
      lastScreen: "thanks",
      origin: { name: "Córdoba", province: "Córdoba", lat: -31.4201, lng: -64.1888 },
      destination: { name: "Rosario", province: "Santa Fe", lat: -32.9442, lng: -60.6505 },
      packagePreset: "small",
      quoteId,
      senderAnswer: "no",
      senderAltChoice: "-20",
      senderWtpArs: 50184,
      courierAnswer: "yes",
      courierWtaArs: 54547.83,
      uberEstimateArs: 445000,
      email: "visitante@mail.com",
      emailConsent: true,
      ...overrides,
    };
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    app = buildApp({ notificationsClient: { sendPush: vi.fn() }, pricingClient, sweepEnabled: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.db.$executeRawUnsafe("TRUNCATE TABLE shipments.pricing_game_sessions");
    vi.mocked(pricingClient.getQuote).mockResolvedValue({
      suggestedPriceArs: 62730,
      calculationMethod: PriceCalculationMethod.DEMAND_FUEL_ROUTES_V1,
      highDemand: false,
      breakdown: breakdown as never,
    });
  });

  it("cotiza, guarda la partida con el precio del servidor y la reenvía sin duplicar", async () => {
    const q = await quote();
    expect(q).toMatchObject({ suggestedPriceArs: 62730, courierEarnArs: 54547.83, commissionRate: 0.15 });

    const id = randomUUID();
    const first = await app.inject({
      method: "PUT",
      url: `/demo/pricing-game/sessions/${id}`,
      headers: DEMO,
      payload: session(q.quoteId, { suggestedPriceArs: 1 }),
    });
    const resent = await app.inject({
      method: "PUT",
      url: `/demo/pricing-game/sessions/${id}`,
      headers: DEMO,
      payload: session(q.quoteId, { suggestedPriceArs: 1 }),
    });

    expect(first.statusCode).toBe(201);
    expect(first.json()).toEqual({ id, created: true, quoteVerified: true });
    expect(resent.statusCode).toBe(200);

    const rows = await app.db.pricingGameSession.findMany();
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.suggestedPriceArs?.toNumber()).toBe(62730);
    expect(row.courierEarnArs?.toNumber()).toBe(54547.83);
    expect(row.commissionRate?.toNumber()).toBe(0.15);
    expect(row.distanceKm?.toNumber()).toBe(401.2);
    expect(row.packageType).toBe("standard_package");
    expect(row.weightKg?.toNumber()).toBe(2);
    expect(row.originLat?.toNumber()).toBe(-31.4201);
    expect(row.breakdown).toMatchObject({ distanceSource: "routes_api" });
    expect(row.email).toBe("visitante@mail.com");
    expect(row.quoteVerified).toBe(true);
  });

  it("stats agrega las partidas del evento sin datos personales", async () => {
    const q = await quote();
    for (const overrides of [
      { senderAnswer: "yes", senderAltChoice: null, senderWtpArs: 62730 },
      { senderAnswer: "no", senderAltChoice: "none", senderWtpArs: null, courierAnswer: "no", courierWtaArs: null },
      { eventTag: "otro-evento" },
    ]) {
      const res = await app.inject({
        method: "PUT",
        url: `/demo/pricing-game/sessions/${randomUUID()}`,
        headers: DEMO,
        payload: session(q.quoteId, overrides),
      });
      expect(res.statusCode).toBe(201);
    }

    const res = await app.inject({ method: "GET", url: "/demo/pricing-game/stats?eventTag=feria-test", headers: DEMO });

    expect(res.statusCode).toBe(200);
    const stats = res.json();
    expect(stats.sessions).toBe(2);
    expect(stats.sender.answers).toEqual({ yes: 1, maybe: 0, no: 1 });
    expect(stats.sender.rejectedAll).toBe(1);
    expect(stats.sender.ratio).toMatchObject({ n: 1, median: 1 });
    expect(stats.byPackage.small.sessions).toBe(2);
    expect(stats.byDistance["100to500"].sessions).toBe(2);
    expect(JSON.stringify(stats)).not.toContain("visitante@mail.com");
  });

  it("503 PRICING_UNAVAILABLE si pricing no responde", async () => {
    vi.mocked(pricingClient.getQuote).mockResolvedValueOnce({
      suggestedPriceArs: null,
      calculationMethod: null,
      highDemand: null,
    });

    const res = await app.inject({
      method: "POST",
      url: "/demo/pricing-game/quote",
      headers: DEMO,
      payload: { origin: { lat: -31, lng: -64 }, destination: { lat: -32, lng: -60 }, packagePreset: "letter" },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("PRICING_UNAVAILABLE");
  });
});
