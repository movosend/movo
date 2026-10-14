import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import TripDepartureReminderSweepPlugin from "../src/plugins/trip-departure-reminder-sweep";
import { EnvConfig } from "../src/config/env";
import { createFakeNotificationsClient } from "./fake-notifications-client";

describe("trip-departure-reminder-sweep plugin (MOVO-240)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 20:00 en Argentina: el barrido consulta viajes.
    vi.setSystemTime(new Date("2026-10-14T23:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function buildTestApp(redisSet: ReturnType<typeof vi.fn>, findMany: ReturnType<typeof vi.fn>) {
    const app = Fastify();
    app.decorate("config", {
      TRIP_DEPARTURE_REMINDER_SWEEP_INTERVAL_MINUTES: 15,
      TRIP_DEPARTURE_REMINDER_SWEEP_ENABLED: true,
    } as EnvConfig);
    app.decorate("db", { trip: { findMany } } as any);
    app.decorate("redis", { set: redisSet, del: vi.fn() } as any);
    return app;
  }

  it("no inicia el timer si está desactivado", async () => {
    const app = buildTestApp(vi.fn(), vi.fn());
    await app.register(TripDepartureReminderSweepPlugin, { enabled: false });
    await app.ready();

    expect(vi.getTimerCount()).toBe(0);
    await app.close();
  });

  it("toma el lock y consulta los viajes de mañana", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const redisSet = vi.fn().mockResolvedValue("OK");
    const app = buildTestApp(redisSet, findMany);
    await app.register(TripDepartureReminderSweepPlugin, {
      notificationsClient: createFakeNotificationsClient(),
      enabled: true,
    });
    await app.ready();

    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);

    expect(redisSet).toHaveBeenCalledWith("locks:trip-departure-reminder-sweep", "locked", "PX", expect.any(Number), "NX");
    expect(findMany).toHaveBeenCalled();
    await app.close();
  });

  it("no corre si otra réplica tiene el lock", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const app = buildTestApp(vi.fn().mockResolvedValue(null), findMany);
    await app.register(TripDepartureReminderSweepPlugin, {
      notificationsClient: createFakeNotificationsClient(),
      enabled: true,
    });
    await app.ready();

    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);

    expect(findMany).not.toHaveBeenCalled();
    await app.close();
  });
});
