import { FastifyInstance } from "fastify";

export interface SweepOptions {
  /** Nombre del barrido, para los logs ("Pickup expiry sweep plugin está desactivado."). */
  name: string;
  lockKey: string;
  intervalMinutes: number;
  enabled: boolean;
  /** Mensaje del log de error si `run` tira. */
  errorMessage: string;
  run: () => Promise<void>;
}

/**
 * Esqueleto común de los barridos periódicos del servicio: `setInterval` + lock
 * distribuido en Redis (`PX`/`NX`) para no duplicar trabajo entre réplicas + limpieza en
 * `onClose`. Cada plugin solo declara su regla en `run`.
 *
 * El TTL del lock es menor al intervalo (80% o mín. 10s) y NO se libera al terminar a
 * propósito: así el lock también limita la frecuencia entre réplicas con relojes
 * desfasados, no solo la concurrencia.
 */
export function registerSweep(app: FastifyInstance, opts: SweepOptions): void {
  if (!opts.enabled || opts.intervalMinutes <= 0) {
    app.log.info(`${opts.name} está desactivado.`);
    return;
  }

  const intervalMs = opts.intervalMinutes * 60 * 1000;
  const lockTtlMs = Math.max(10_000, Math.floor(intervalMs * 0.8));

  const runSweep = async () => {
    try {
      const acquired = await app.redis.set(
        opts.lockKey,
        "locked",
        "PX",
        lockTtlMs,
        "NX",
      );
      if (acquired !== "OK") {
        app.log.debug(
          { lockKey: opts.lockKey },
          "Sweep omitido: otra instancia tiene el lock de Redis.",
        );
        return;
      }

      await opts.run();
    } catch (err) {
      app.log.error({ err }, opts.errorMessage);
    }
  };

  const timer = setInterval(runSweep, intervalMs);

  app.addHook("onClose", async () => {
    clearInterval(timer);
  });
}
