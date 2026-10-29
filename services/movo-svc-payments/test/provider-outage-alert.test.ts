import { describe, it, expect, vi } from "vitest";
import { createProviderOutageAlert } from "../src/modules/holds/provider-outage-alert";
import type { AlertNotifier } from "../src/adapters/alert-notifier";

// MOVO-346 (punto 2): alerta al equipo cuando MP no responde a varios intentos de hold seguidos.
function memoryRedis(opts: { fail?: boolean } = {}) {
  const counters = new Map<string, number>();
  return {
    counters,
    async incr(key: string) {
      if (opts.fail) throw new Error("redis caído");
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return next;
    },
    async expire() {
      return 1 as const;
    },
  };
}

const failure = { shipmentId: "s1", holdId: "h1", mpHttpStatus: 503 };
const log = { warn: vi.fn() };

describe("provider-outage-alert", () => {
  it("avisa una sola vez por ventana, al llegar a 3 fallas", async () => {
    const alerts: AlertNotifier = { send: vi.fn().mockResolvedValue(undefined) };
    const clock = new Date("2026-10-25T20:41:00.000Z");
    const outage = createProviderOutageAlert({ redis: memoryRedis(), alerts: () => alerts, log, now: () => clock });

    await outage.record(failure);
    await outage.record(failure);
    expect(alerts.send).not.toHaveBeenCalled();

    await outage.record(failure);
    await outage.record(failure);
    expect(alerts.send).toHaveBeenCalledTimes(1);
    expect(alerts.send).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "mp_hold_create_unavailable", context: expect.objectContaining({ failures: 3 }) }),
    );
  });

  it("una ventana nueva vuelve a contar desde cero", async () => {
    const alerts: AlertNotifier = { send: vi.fn().mockResolvedValue(undefined) };
    let clock = new Date("2026-10-25T20:41:00.000Z");
    const outage = createProviderOutageAlert({ redis: memoryRedis(), alerts: () => alerts, log, now: () => clock });

    await outage.record(failure);
    await outage.record(failure);
    clock = new Date("2026-10-25T20:51:00.000Z");
    await outage.record(failure);
    expect(alerts.send).not.toHaveBeenCalled();
  });

  it("con Redis caído o sin notificador no tira", async () => {
    const down = createProviderOutageAlert({ redis: memoryRedis({ fail: true }), alerts: () => undefined, log });
    await expect(down.record(failure)).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalled();
  });
});
