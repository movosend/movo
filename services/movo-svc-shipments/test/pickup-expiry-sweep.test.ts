import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import pickupExpirySweepPlugin from "../src/plugins/pickup-expiry-sweep";
import { EnvConfig } from "../src/config/env";
import { createFakeUsersClient } from "./fake-users-client";
import { createFakeNotificationsClient } from "./fake-notifications-client";

describe("pickup-expiry-sweep plugin", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("no inicia el timer si enabled es false o el intervalo es <= 0", async () => {
    const app = Fastify();
    app.decorate("config", {
      PICKUP_EXPIRY_SWEEP_INTERVAL_MINUTES: 15,
      PICKUP_EXPIRY_SWEEP_ENABLED: false,
    } as EnvConfig);
    app.decorate("db", {} as any);
    app.decorate("redis", {} as any);

    await app.register(pickupExpirySweepPlugin, { enabled: false });
    await app.ready();

    expect(vi.getTimerCount()).toBe(0);
    await app.close();
  });

  it("inicia el timer y ejecuta el sweep adquiriendo el lock en Redis", async () => {
    const app = Fastify();
    app.decorate("config", {
      PICKUP_EXPIRY_SWEEP_INTERVAL_MINUTES: 15,
      PICKUP_EXPIRY_SWEEP_ENABLED: true,
    } as EnvConfig);

    const mockFindMany = vi.fn().mockResolvedValue([]);
    app.decorate("db", {
      shipment: {
        findMany: mockFindMany,
      },
    } as any);

    const mockRedisSet = vi.fn().mockResolvedValue("OK");
    app.decorate("redis", {
      set: mockRedisSet,
    } as any);

    const usersClient = createFakeUsersClient({});
    const notificationsClient = createFakeNotificationsClient();

    await app.register(pickupExpirySweepPlugin, {
      usersClient,
      notificationsClient,
      enabled: true,
    });
    await app.ready();

    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);

    expect(mockRedisSet).toHaveBeenCalledWith("locks:pickup-expiry-sweep", "locked", "PX", expect.any(Number), "NX");
    expect(mockFindMany).toHaveBeenCalled();

    await app.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("omite el sweep si no puede adquirir el lock de Redis (otra réplica corriendo)", async () => {
    const app = Fastify();
    app.decorate("config", {
      PICKUP_EXPIRY_SWEEP_INTERVAL_MINUTES: 15,
      PICKUP_EXPIRY_SWEEP_ENABLED: true,
    } as EnvConfig);

    const mockFindMany = vi.fn().mockResolvedValue([]);
    app.decorate("db", {
      shipment: {
        findMany: mockFindMany,
      },
    } as any);

    const mockRedisSet = vi.fn().mockResolvedValue(null);
    app.decorate("redis", {
      set: mockRedisSet,
    } as any);

    await app.register(pickupExpirySweepPlugin, { enabled: true });
    await app.ready();

    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);

    expect(mockRedisSet).toHaveBeenCalled();
    expect(mockFindMany).not.toHaveBeenCalled();

    await app.close();
  });
});
