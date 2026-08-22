import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import { createUserRepository, UserRepository } from "../repositories/user-repository";
import { createStorageProvider, StorageProvider } from "../adapters/storage-provider";
import { PENDING_PHOTOS_REDIS_KEY } from "../modules/users/users.service";

const BATCH_SIZE = 100;

export interface OrphanPhotoSweepPluginOptions {
  storageProvider?: StorageProvider;
  enabled?: boolean;
}

/**
 * MOVO-124: barre `photos:pending:profile-photos` (Redis) buscando keys de S3
 * presignadas y nunca confirmadas, y las borra del bucket pasada una ventana
 * razonable. Mismo esqueleto que `receiver-confirmation-sweep.ts` de
 * `movo-svc-shipments` (MOVO-130) y su gemelo `orphan-photo-sweep.ts` de ese mismo
 * servicio (MOVO-124): `setInterval` + lock distribuido en Redis, sin infra de cron
 * separada (ADR-006). Primer scheduled job de `movo-svc-users`.
 *
 * Reemplaza las dos opciones de lifecycle rule de S3 propuestas originalmente en el
 * ticket (tagging + `PutObjectTagging`/prefijo de cuarentena + `CopyObject`) -- ninguna
 * de las dos toca Terraform ni agrega permisos IAM nuevos (`s3:DeleteObject` ya está
 * concedido para `profile-photos/*` desde MOVO-97). Decisión documentada en el
 * comentario de MOVO-124 en Linear.
 */
export default fp(async (app: FastifyInstance, opts: OrphanPhotoSweepPluginOptions = {}) => {
  const isEnabled = opts.enabled ?? app.config.ORPHAN_PHOTO_SWEEP_ENABLED ?? true;
  const intervalMinutes = app.config.ORPHAN_PHOTO_SWEEP_INTERVAL_MINUTES;

  if (!isEnabled || intervalMinutes <= 0) {
    app.log.info("Orphan photo sweep plugin está desactivado.");
    return;
  }

  const repository: UserRepository = createUserRepository(app.db);
  const storageProvider = opts.storageProvider ?? createStorageProvider(app.config);

  const intervalMs = intervalMinutes * 60 * 1000;
  // TTL del lock: menor al intervalo (80% del intervalo o mín 10s) para evitar ejecuciones concurrentes en réplicas
  const lockTtlMs = Math.max(10_000, Math.floor(intervalMs * 0.8));
  const lockKey = "locks:orphan-photo-sweep:profile-photos";

  const runSweep = async () => {
    try {
      const acquired = await app.redis.set(lockKey, "locked", "PX", lockTtlMs, "NX");
      if (acquired !== "OK") {
        app.log.debug({ lockKey }, "Sweep omitido: otra instancia tiene el lock de Redis.");
        return;
      }

      const cutoff = Date.now() - app.config.ORPHAN_PHOTO_RETENTION_HOURS * 60 * 60 * 1000;
      const candidates = await app.redis.zrangebyscore(
        PENDING_PHOTOS_REDIS_KEY,
        "-inf",
        cutoff,
        "LIMIT",
        0,
        BATCH_SIZE
      );

      for (const objectKey of candidates) {
        try {
          // AC3 de MOVO-124: nunca confiar solo en que Redis diga "no confirmado" --
          // Postgres es la fuente de verdad real. Si el ZREM de confirmPhoto falló por
          // algún motivo y la key sigue acá pese a estar confirmada, se la saca del
          // tracking sin tocar el objeto de S3.
          const photoUrl = storageProvider.getPublicUrl(objectKey);
          const confirmed = await repository.existsByPhotoUrl(photoUrl);
          if (confirmed) {
            await app.redis.zrem(PENDING_PHOTOS_REDIS_KEY, objectKey);
            continue;
          }

          await storageProvider.deleteObject(objectKey);
          await app.redis.zrem(PENDING_PHOTOS_REDIS_KEY, objectKey);
        } catch (err) {
          // No se remueve del set en este caso -- reintenta en la próxima corrida.
          app.log.warn({ err, objectKey }, "No se pudo procesar un candidato del sweep de fotos huérfanas");
        }
      }
    } catch (err) {
      app.log.error({ err }, "Error inesperado durante el sweep de fotos huérfanas de S3");
    }
  };

  const timer = setInterval(runSweep, intervalMs);

  app.addHook("onClose", async () => {
    clearInterval(timer);
  });
});
