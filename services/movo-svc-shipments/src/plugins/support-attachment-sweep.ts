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
 * acá Postgres ya sabe qué está sin usar. En dos pasos (review de la PR #299): primero se marca la fila
 * (`deleting_at`), y desde ahí ningún mensaje puede asociarla, así que no hay carrera con `sendMessage`; después se
 * borra el objeto y recién entonces la fila. Si S3 falla (p. ej. sin `s3:DeleteObject`), la fila sigue marcada y la
 * próxima corrida reintenta: la key nunca se pierde. Devuelve cuántos terminó de borrar. Exportada para probarla sin
 * esperar el intervalo.
 */
export async function sweepSupportAttachments(input: {
  repository: SupportAttachmentRepository;
  storage: StorageProvider;
  cutoff: Date;
  now?: Date;
  logger: FastifyBaseLogger;
}): Promise<number> {
  const marked = await input.repository.markOrphansForDeletion(input.cutoff, input.now ?? new Date(), BATCH_SIZE);
  let deleted = 0;
  for (const { id, s3Key } of marked) {
    try {
      await input.storage.deleteObject(s3Key);
      await input.repository.deleteMarked(id);
      deleted += 1;
    } catch (err) {
      input.logger.warn({ err, s3Key }, "No se pudo borrar un adjunto de soporte huérfano; se reintenta en la próxima corrida");
    }
  }
  return deleted;
}

/**
 * MOVO-321 AC4: limpieza de adjuntos de soporte nunca usados. Es la única limpieza: el bucket no lleva regla de
 * lifecycle para `support/*`, porque el objeto de `support/pending/…` no se mueve al usarse y una regla por prefijo
 * borraría fotos en uso. Reusa la ventana, el intervalo y el interruptor del sweep de fotos huérfanas
 * (`ORPHAN_PHOTO_*`): es la misma regla para el mismo bucket y así no hay env vars nuevas.
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
