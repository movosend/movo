import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { registerSweep } from "../src/plugins/register-sweep";

function fakeApp() {
  const hooks: Array<() => Promise<void>> = [];
  const app = {
    redis: { set: vi.fn(async (): Promise<string | null> => "OK") },
    log: { info: vi.fn(), debug: vi.fn(), error: vi.fn() },
    addHook: vi.fn((_name: string, fn: () => Promise<void>) => hooks.push(fn)),
  };
  return { app, hooks, instance: app as unknown as FastifyInstance };
}

describe("registerSweep", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const opts = (run: () => Promise<void>, enabled = true) => ({
    name: "Sweep de prueba",
    lockKey: "lock:test",
    intervalMinutes: 60,
    enabled,
    errorMessage: "falló",
    run,
  });

  it("corre una vez poco después de arrancar, sin esperar el primer intervalo", async () => {
    const run = vi.fn(async () => undefined);
    registerSweep(fakeApp().instance, opts(run));

    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("después sigue corriendo cada intervalo", async () => {
    const run = vi.fn(async () => undefined);
    registerSweep(fakeApp().instance, opts(run));

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("no corre si otra instancia tiene el lock", async () => {
    const run = vi.fn(async () => undefined);
    const { app, instance } = fakeApp();
    app.redis.set.mockResolvedValue(null);
    registerSweep(instance, opts(run));

    await vi.advanceTimersByTimeAsync(30_000);
    expect(run).not.toHaveBeenCalled();
  });

  it("al cerrar la app cancela la corrida inicial y el intervalo", async () => {
    const run = vi.fn(async () => undefined);
    const { hooks, instance } = fakeApp();
    registerSweep(instance, opts(run));

    await hooks[0]();
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
    expect(run).not.toHaveBeenCalled();
  });

  it("desactivado no programa nada", async () => {
    const run = vi.fn(async () => undefined);
    registerSweep(fakeApp().instance, opts(run, false));

    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
    expect(run).not.toHaveBeenCalled();
  });
});
