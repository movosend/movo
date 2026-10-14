import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import { registerSweep } from "./register-sweep";

export interface MpTokenRefreshSweepPluginOptions {
  enabled?: boolean;
}

/**
 * MOVO-243: barrido periódico que renueva los tokens OAuth de los transportistas antes de
 * que venzan y marca `revoked_at` si el acceso fue revocado desde MP. Mismo esqueleto que
 * los barridos de `svc-shipments` (`setInterval` + lock Redis). Va después de
 * `mpConnectPlugin`, que decora `app.mpConnect`.
 */
export default fp(async (app: FastifyInstance, opts: MpTokenRefreshSweepPluginOptions = {}) => {
  registerSweep(app, {
    name: "MP token refresh sweep plugin",
    lockKey: "locks:mp-token-refresh-sweep",
    enabled: opts.enabled ?? app.config.MP_TOKEN_REFRESH_SWEEP_ENABLED,
    intervalMinutes: app.config.MP_TOKEN_REFRESH_SWEEP_INTERVAL_MINUTES,
    errorMessage: "Error inesperado durante la renovación de tokens de MP",
    run: async () => {
      await app.mpConnect.refreshDueTokens();
    },
  });
});
