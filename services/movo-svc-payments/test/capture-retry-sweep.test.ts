import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import captureRetrySweepPlugin from "../src/plugins/capture-retry-sweep";
import { buildApp } from "../src/app";

// MOVO-213: el plugin del barrido de reintentos. La lógica de cada pasada se prueba en
// `capture-retry.integration.test.ts`; acá, el cableado: timer, lock de Redis y arranque.

function fakeApp(config: Partial<{ enabled: boolean; interval: number }> = {}) {
  const findMany = vi.fn(async () => []);
  const app = {
    config: {
      SETTLEMENT_RETRY_SWEEP_ENABLED: config.enabled ?? true,
      SETTLEMENT_RETRY_SWEEP_INTERVAL_MINUTES: config.interval ?? 1,
    },
    db: { settlement: { findMany } },
    redis: { set: vi.fn(async (): Promise<string | null> => "OK") },
    log: { info: vi.fn(), debug: vi.fn(), error: vi.fn() },
    captures: { capture: vi.fn(), escalateUnrecoverable: vi.fn() },
    shipmentsClient: { notifySettlementEvent: vi.fn() },
    addHook: vi.fn(),
    decorate: vi.fn(),
  };
  return { app, findMany, instance: app as unknown as FastifyInstance };
}

// `fp()` devuelve la función del plugin con metadatos; se invoca directo con la app de mentira.
const register = (instance: FastifyInstance, opts?: { enabled?: boolean }) =>
  (captureRetrySweepPlugin as unknown as (app: FastifyInstance, opts?: object) => Promise<void>)(instance, opts);

describe("capture-retry-sweep (MOVO-213)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("a los 30 s del arranque busca las capturas vencidas, con el lock de su propia clave", async () => {
    const { app, findMany, instance } = fakeApp();
    await register(instance);

    await vi.advanceTimersByTimeAsync(30_000);

    expect(app.redis.set).toHaveBeenCalledWith("locks:capture-retry-sweep", "locked", "PX", expect.any(Number), "NX");
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0]).toMatchObject({ where: { status: "failed", kind: "delivery" } });
  });

  it("si otra réplica tiene el lock, no busca nada", async () => {
    const { app, findMany, instance } = fakeApp();
    app.redis.set.mockResolvedValue(null);
    await register(instance);

    await vi.advanceTimersByTimeAsync(30_000);

    expect(findMany).not.toHaveBeenCalled();
  });

  it("deshabilitado (por opción o por env) no arma ningún timer", async () => {
    const byOption = fakeApp();
    await register(byOption.instance, { enabled: false });
    const byEnv = fakeApp({ enabled: false });
    await register(byEnv.instance);

    await vi.advanceTimersByTimeAsync(5 * 60_000);

    expect(byOption.findMany).not.toHaveBeenCalled();
    expect(byEnv.findMany).not.toHaveBeenCalled();
  });

  it("decora `captureRetry` para que los tests y la operación puedan forzar una pasada", async () => {
    const { app, instance } = fakeApp();
    await register(instance, { enabled: false });
    expect(app.decorate).toHaveBeenCalledWith("captureRetry", expect.objectContaining({ runOnce: expect.any(Function) }));
  });
});

describe("arranque con SETTLEMENT_RETRY_DELAYS_MINUTES inválido (MOVO-213)", () => {
  afterEach(() => {
    delete process.env.SETTLEMENT_RETRY_DELAYS_MINUTES;
  });

  it("corta el boot en vez de arrancar con un backoff roto", async () => {
    process.env.JWT_SECRET = "test-secret";
    process.env.DATABASE_URL ??= "postgresql://movo:movo@localhost:5432/movo";
    process.env.REDIS_URL ??= "redis://localhost:6379";
    process.env.SETTLEMENT_RETRY_DELAYS_MINUTES = "5,abc";
    const app = buildApp({ captureRetrySweepEnabled: false, mpTokenRefreshSweepEnabled: false });

    await expect(app.ready()).rejects.toThrow(/SETTLEMENT_RETRY_DELAYS_MINUTES/);
    await app.close().catch(() => undefined);
  });
});
