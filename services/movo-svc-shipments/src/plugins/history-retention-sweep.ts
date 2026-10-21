import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import { registerSweep } from "./register-sweep";
import { createStorageProvider, StorageProvider } from "../adapters/storage-provider";
import { createUserDeletionClient, UserDeletionClient } from "../adapters/users-client";
import { createRetentionRepository } from "../repositories/retention-repository";
import { createHistoryRetentionService } from "../services/history-retention-service";

export interface HistoryRetentionSweepPluginOptions {
  enabled?: boolean;
  storageProvider?: StorageProvider;
  deletionClient?: UserDeletionClient;
}

/**
 * MOVO-230 (Política de Privacidad §7): purga el historial de envíos y los viajes cuyas partes
 * se dieron de baja hace más de `SHIPMENT_HISTORY_RETENTION_YEARS` años (regla en
 * `services/history-retention-service.ts`). Mismo esqueleto `setInterval` + lock de Redis que
 * `carrier-position-purge-sweep.ts`.
 */
export default fp(async (app: FastifyInstance, opts: HistoryRetentionSweepPluginOptions = {}) => {
  const service = createHistoryRetentionService(
    createRetentionRepository(app.db),
    opts.deletionClient ?? createUserDeletionClient(app.config),
    opts.storageProvider ?? createStorageProvider(app.config),
    app.log,
  );

  registerSweep(app, {
    name: "History retention sweep plugin",
    lockKey: "locks:history-retention-sweep",
    enabled: opts.enabled ?? app.config.SHIPMENT_HISTORY_PURGE_SWEEP_ENABLED ?? true,
    intervalMinutes: app.config.SHIPMENT_HISTORY_PURGE_SWEEP_INTERVAL_MINUTES,
    errorMessage: "Error inesperado durante la purga de historial de envíos vencido",
    run: async () => {
      const result = await service.purgeExpiredHistory(new Date(), app.config.SHIPMENT_HISTORY_RETENTION_YEARS);
      app.log.info({ event: "history_retention_sweep_done", ...result }, "Purga de historial de envíos vencido");
    },
  });
});
