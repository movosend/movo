import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import tripExpirySweepPlugin from "../src/plugins/trip-expiry-sweep";
import { EnvConfig } from "../src/config/env";

function buildTestApp(redisResult: string | null) {
  const app = Fastify();
  app.decorate("config", {
    TRIP_EXPIRY_SWEEP_INTERVAL_MINUTES: 15,
    TRIP_EXPIRY_SWEEP_ENABLED: true,
  } as EnvConfig);
  const findMany = vi.fn().mockResolvedValue([{ id: "trip-1" }]);
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  app.decorate("db", { trip: { findMany, updateMany } } as unknown as FastifyInstance["db"]);
  const redisSet = vi.fn().mockResolvedValue(redisResult);
  app.decorate("redis", { set: redisSet } as unknown as FastifyInstance["redis"]);
  return { app, findMany, updateMany, redisSet };
}

describe("trip-expiry-sweep plugin", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("no inicia el timer si enabled es false", async () => {
    const { app } = buildTestApp("OK");

    await app.register(tripExpirySweepPlugin, { enabled: false });
    await app.ready();

    expect(vi.getTimerCount()).toBe(0);
    await app.close();
  });

  it("adquiere el lock y cancela los viajes vencidos", async () => {
    const { app, findMany, updateMany, redisSet } = buildTestApp("OK");

    await app.register(tripExpirySweepPlugin, { enabled: true });
    await app.ready();
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);

    expect(redisSet).toHaveBeenCalledWith("locks:trip-expiry-sweep", "locked", "PX", expect.any(Number), "NX");
    expect(findMany).toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "cancelled" } }));

    await app.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("omite el sweep si otra réplica tiene el lock", async () => {
    const { app, findMany, redisSet } = buildTestApp(null);

    await app.register(tripExpirySweepPlugin, { enabled: true });
    await app.ready();

    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);

    expect(redisSet).toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
    await app.close();
  });
});
