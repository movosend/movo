import fp from "fastify-plugin";
import { FastifyBaseLogger, FastifyInstance } from "fastify";
import { registerSweep } from "./register-sweep";
import { createStorageProvider, StorageProvider } from "../adapters/storage-provider";
import {
  createSupportAttachmentRepository,
  SupportAttachmentRepository,
} from "../repositories/support-attachment-repository";

const BATCH_SIZE = 100;

export interface SupportAttachmentSweepPluginOptions {
  storageProvider?: StorageProvider;
  enabled?: boolean;
}

/**
 * Una corrida: borra los adjuntos de soporte que nunca se asociaron a un mensaje y tienen más de `cutoff`. A
 * diferencia de las fotos del envío (`orphan-photo-sweep.ts`, que necesita un sorted set de Redis y un lock por key)
 * acá Postgres ya sabe qué está sin usar, y la fila se borra antes que el objeto: desde ese momento ningún mensaje
 * puede asociarlo (el `UPDATE … WHERE message_id IS NULL` no matchea), así que no hay carrera con `sendMessage`. Si
 * falla el borrado en S3 el objeto queda huérfano sin fila: lo cubre la regla de lifecycle del bucket (pendiente en
 * `movo-infra`). Exportada para probarla sin esperar el intervalo.
 */
export async function sweepSupportAttachments(input: {
  repository: SupportAttachmentRepository;
  storage: StorageProvider;
  cutoff: Date;
  logger: FastifyBaseLogger;
}): Promise<number> {
  const keys = await input.repository.deleteOrphans(input.cutoff, BATCH_SIZE);
  for (const key of keys) {
    try {
      await input.storage.deleteObject(key);
    } catch (err) {
      input.logger.warn({ err, s3Key: key }, "No se pudo borrar del storage un adjunto de soporte huérfano");
    }
  }
  return keys.length;
}

/**
 * MOVO-321 AC4: limpieza de adjuntos de soporte nunca usados. Reusa la ventana, el intervalo y el interruptor del
 * sweep de fotos huérfanas (`ORPHAN_PHOTO_*`): es la misma regla para el mismo bucket y así no hay env vars nuevas.
 */
export default fp(async (app: FastifyInstance, opts: SupportAttachmentSweepPluginOptions = {}) => {
  const repository = createSupportAttachmentRepository(app.db);
  const storage = opts.storageProvider ?? createStorageProvider(app.config);

  registerSweep(app, {
    name: "Support attachment sweep plugin",
    lockKey: "locks:support-attachment-sweep",
    enabled: opts.enabled ?? app.config.ORPHAN_PHOTO_SWEEP_ENABLED ?? true,
    intervalMinutes: app.config.ORPHAN_PHOTO_SWEEP_INTERVAL_MINUTES,
    errorMessage: "Error inesperado durante el sweep de adjuntos de soporte huérfanos",
    run: async () => {
      const cutoff = new Date(Date.now() - app.config.ORPHAN_PHOTO_RETENTION_HOURS * 60 * 60 * 1000);
      await sweepSupportAttachments({ repository, storage, cutoff, logger: app.log });
    },
  });
});
