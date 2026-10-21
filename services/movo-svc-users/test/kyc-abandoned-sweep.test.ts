import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import kycAbandonedSweepPlugin from "../src/plugins/kyc-abandoned-sweep";
import { EnvConfig } from "../src/config/env";

const INTERVAL_MINUTES = 60;

function buildConfig(overrides: Partial<EnvConfig> = {}): EnvConfig {
  return {
    KYC_ABANDONED_RETENTION_DAYS: 30,
    KYC_ABANDONED_SWEEP_INTERVAL_MINUTES: INTERVAL_MINUTES,
    KYC_ABANDONED_SWEEP_ENABLED: true,
    ...overrides,
  } as EnvConfig;
}

function buildDb() {
  const tx = {
    kycVerification: {
      findMany: vi.fn().mockResolvedValue([
        { id: "k1", userId: "u1", verificationType: "identity", status: "pending" },
        { id: "k2", userId: "u2", verificationType: "license", status: "expired" },
      ]),
      deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
    },
    user: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  return { tx, db: { $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)) } };
}

describe("kyc-abandoned-sweep plugin (MOVO-230)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("no inicia el timer si está deshabilitado", async () => {
    const app = Fastify();
    app.decorate("config", buildConfig({ KYC_ABANDONED_SWEEP_ENABLED: false }));
    app.decorate("db", {} as any);
    app.decorate("redis", {} as any);

    await app.register(kycAbandonedSweepPlugin);
    await app.ready();

    expect(vi.getTimerCount()).toBe(0);
    await app.close();
  });

  it("con el lock, borra los intentos abandonados anteriores al corte y resetea el caché de los pending", async () => {
    vi.setSystemTime(new Date("2026-10-21T12:00:00Z"));
    const app = Fastify();
    app.decorate("config", buildConfig());
    const { db, tx } = buildDb();
    app.decorate("db", db as any);
    const redisSet = vi.fn().mockResolvedValue("OK");
    app.decorate("redis", { set: redisSet } as any);

    await app.register(kycAbandonedSweepPlugin);
    await app.ready();
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(INTERVAL_MINUTES * 60 * 1000);

    expect(redisSet).toHaveBeenCalledWith("locks:kyc-abandoned-sweep", "locked", "PX", expect.any(Number), "NX");
    const where = tx.kycVerification.findMany.mock.calls[0][0].where;
    expect(where.status).toEqual({ in: ["pending", "expired"] });
    // 30 días antes de la corrida (la corrida es una hora después del arranque).
    expect(where.requestedAt.lt).toEqual(new Date("2026-09-21T13:00:00Z"));
    expect(tx.kycVerification.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["k1", "k2"] }, status: { in: ["pending", "expired"] } },
    });
    // Solo el `pending` de identidad toca el caché; el `expired` de licencia no.
    expect(tx.user.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["u1"] }, kycStatusIdentity: "pending" },
      data: { kycStatusIdentity: "not_started" },
    });

    await app.close();
  });

  it("sin el lock no toca la DB", async () => {
    const app = Fastify();
    app.decorate("config", buildConfig());
    const { db } = buildDb();
    app.decorate("db", db as any);
    app.decorate("redis", { set: vi.fn().mockResolvedValue(null) } as any);

    await app.register(kycAbandonedSweepPlugin);
    await app.ready();
    await vi.advanceTimersByTimeAsync(INTERVAL_MINUTES * 60 * 1000);

    expect(db.$transaction).not.toHaveBeenCalled();
    await app.close();
  });
});
