import type Redis from "ioredis";
import type { FastifyBaseLogger } from "fastify";
import type { AlertNotifier } from "../../adapters/alert-notifier";

/** Fallas de MP al crear un hold que disparan la alerta, dentro de la misma ventana. */
export const MP_HOLD_UNAVAILABLE_THRESHOLD = 3;
export const MP_HOLD_UNAVAILABLE_WINDOW_SECONDS = 10 * 60;

export interface HoldProviderFailure {
  shipmentId: string;
  holdId: string;
  mpHttpStatus: number | null;
}

export interface ProviderOutageAlertDeps {
  redis: Pick<Redis, "incr" | "expire">;
  /** Se resuelve al llamar: el notificador lo arma un plugin que se registra después que el de holds. */
  alerts: () => AlertNotifier | undefined;
  log: Pick<FastifyBaseLogger, "warn">;
  now?: () => Date;
}

/**
 * MOVO-346 (punto 2): en la prueba del 25/10 Mercado Pago no respondió a 4 intentos de hold seguidos y nadie
 * se enteró hasta mirar los logs. Cuenta las fallas por ventana fija de 10 min en Redis y avisa al equipo una
 * sola vez por ventana, al llegar a `MP_HOLD_UNAVAILABLE_THRESHOLD`. Nunca tira: el 502 al emisor sale igual.
 */
export function createProviderOutageAlert(deps: ProviderOutageAlertDeps) {
  const now = deps.now ?? (() => new Date());
  return {
    async record(failure: HoldProviderFailure): Promise<void> {
      try {
        const windowStart =
          Math.floor(now().getTime() / (MP_HOLD_UNAVAILABLE_WINDOW_SECONDS * 1000)) * MP_HOLD_UNAVAILABLE_WINDOW_SECONDS;
        const key = `alert:mp_hold_create_unavailable:${windowStart}`;
        const count = await deps.redis.incr(key);
        if (count === 1) await deps.redis.expire(key, MP_HOLD_UNAVAILABLE_WINDOW_SECONDS);
        if (count !== MP_HOLD_UNAVAILABLE_THRESHOLD) return;
        await deps.alerts()?.send({
          kind: "mp_hold_create_unavailable",
          message: `Mercado Pago no respondió a ${count} intentos de crear un hold en menos de 10 min`,
          context: {
            failures: count,
            windowStart: new Date(windowStart * 1000).toISOString(),
            lastShipmentId: failure.shipmentId,
            lastHoldId: failure.holdId,
            lastMpHttpStatus: failure.mpHttpStatus,
          },
        });
      } catch (err) {
        deps.log.warn({ err, event: "mp_hold_unavailable_alert_failed" }, "No se pudo contar o avisar la falla de MP");
      }
    },
  };
}
