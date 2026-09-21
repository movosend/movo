import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import carrierPositionPurgeSweepPlugin from "../src/plugins/carrier-position-purge-sweep";
import { EnvConfig } from "../src/config/env";

describe("carrier-position-purge-sweep plugin (MOVO-202)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("no inicia el timer si enabled es false o el intervalo es <= 0", async () => {
    const app = Fastify();
    app.decorate("config", {
      CARRIER_POSITION_PURGE_SWEEP_INTERVAL_MINUTES: 60,
      CARRIER_POSITION_PURGE_SWEEP_ENABLED: false,
      CARRIER_POSITION_RETENTION_DAYS: 30,
    } as EnvConfig);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app.decorate("db", {} as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app.decorate("redis", {} as any);

    await app.register(carrierPositionPurgeSweepPlugin, { enabled: false });
    await app.ready();

    expect(vi.getTimerCount()).toBe(0);
    await app.close();
  });

  it("inicia el timer, adquiere el lock y corre la purga con el retentionDays configurado", async () => {
    const app = Fastify();
    app.decorate("config", {
      CARRIER_POSITION_PURGE_SWEEP_INTERVAL_MINUTES: 60,
      CARRIER_POSITION_PURGE_SWEEP_ENABLED: true,
      CARRIER_POSITION_RETENTION_DAYS: 30,
    } as EnvConfig);

    const mockDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app.decorate("db", { carrierPosition: { deleteMany: mockDeleteMany } } as any);

    const mockRedisSet = vi.fn().mockResolvedValue("OK");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app.decorate("redis", { set: mockRedisSet } as any);

    await app.register(carrierPositionPurgeSweepPlugin, { enabled: true });
    await app.ready();

    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    expect(mockRedisSet).toHaveBeenCalledWith(
      "locks:carrier-position-purge-sweep",
      "locked",
      "PX",
      expect.any(Number),
      "NX"
    );
    expect(mockDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          shipment: expect.objectContaining({
            status: { in: ["delivered", "completed", "cancelled", "rejected_by_receiver"] },
          }),
        }),
      })
    );

    await app.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("omite la corrida si no puede adquirir el lock de Redis (otra réplica corriendo)", async () => {
    const app = Fastify();
    app.decorate("config", {
      CARRIER_POSITION_PURGE_SWEEP_INTERVAL_MINUTES: 60,
      CARRIER_POSITION_PURGE_SWEEP_ENABLED: true,
      CARRIER_POSITION_RETENTION_DAYS: 30,
    } as EnvConfig);

    const mockDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app.decorate("db", { carrierPosition: { deleteMany: mockDeleteMany } } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app.decorate("redis", { set: vi.fn().mockResolvedValue(null) } as any);

    await app.register(carrierPositionPurgeSweepPlugin, { enabled: true });
    await app.ready();

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    expect(mockDeleteMany).not.toHaveBeenCalled();

    await app.close();
  });
});
