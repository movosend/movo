import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import { createUserRepository, UserRepository } from "../repositories/user-repository";
import { createStorageProvider, StorageProvider } from "../adapters/storage-provider";
import { createModerationRepository } from "../repositories/moderation-repository";
import {
  PENDING_PHOTOS_REDIS_KEY,
  photoConfirmationLockKey,
  PHOTO_CONFIRMATION_LOCK_TTL_MS,
} from "../modules/users/users.service";
import {
  PENDING_REPORT_PHOTOS_REDIS_KEY,
  reportPhotoLockKey,
  REPORT_PHOTO_LOCK_TTL_MS,
} from "../modules/moderation/moderation.service";

const BATCH_SIZE = 100;

/** Un prefijo barrido: de dónde salen los candidatos, qué lock por key comparte con
 * quien confirma/asocia la foto, y cómo se pregunta a Postgres si ya quedó en uso. */
interface SweepTarget {
  name: string;
  pendingKey: string;
  keyLock: (objectKey: string) => string;
  keyLockTtlMs: number;
  isConfirmed: (objectKey: string) => Promise<boolean>;
}

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
 *
 * MOVO-256: barre también `photos:pending:reports` (fotos de evidencia de reportes,
 * `reports/*`) con el mismo algoritmo; la fuente de verdad ahí es
 * `users.user_report_photos`. Cada prefijo tiene su propio lock global, así una
 * corrida lenta de uno no frena al otro.
 */
export default fp(async (app: FastifyInstance, opts: OrphanPhotoSweepPluginOptions = {}) => {
  const isEnabled = opts.enabled ?? app.config.ORPHAN_PHOTO_SWEEP_ENABLED ?? true;
  const intervalMinutes = app.config.ORPHAN_PHOTO_SWEEP_INTERVAL_MINUTES;

  if (!isEnabled || intervalMinutes <= 0) {
    app.log.info("Orphan photo sweep plugin está desactivado.");
    return;
  }

  const repository: UserRepository = createUserRepository(app.db);
  const moderationRepository = createModerationRepository(app.db);
  const storageProvider = opts.storageProvider ?? createStorageProvider(app.config);

  const intervalMs = intervalMinutes * 60 * 1000;
  // TTL del lock: menor al intervalo (80% del intervalo o mín 10s) para evitar ejecuciones concurrentes en réplicas
  const lockTtlMs = Math.max(10_000, Math.floor(intervalMs * 0.8));

  const targets: SweepTarget[] = [
    {
      name: "profile-photos",
      pendingKey: PENDING_PHOTOS_REDIS_KEY,
      keyLock: photoConfirmationLockKey,
      keyLockTtlMs: PHOTO_CONFIRMATION_LOCK_TTL_MS,
      // AC3 de MOVO-124: la foto de perfil confirmada es la que figura en `photo_url`.
      isConfirmed: (objectKey) => repository.existsByPhotoUrl(storageProvider.getPublicUrl(objectKey)),
    },
    {
      name: "reports",
      pendingKey: PENDING_REPORT_PHOTOS_REDIS_KEY,
      keyLock: reportPhotoLockKey,
      keyLockTtlMs: REPORT_PHOTO_LOCK_TTL_MS,
      isConfirmed: (objectKey) => moderationRepository.existsReportPhotoByS3Key(objectKey),
    },
  ];

  const sweepTarget = async (target: SweepTarget) => {
    const lockKey = `locks:orphan-photo-sweep:${target.name}`;
    try {
      const acquired = await app.redis.set(lockKey, "locked", "PX", lockTtlMs, "NX");
      if (acquired !== "OK") {
        app.log.debug({ lockKey }, "Sweep omitido: otra instancia tiene el lock de Redis.");
        return;
      }

      const cutoff = Date.now() - app.config.ORPHAN_PHOTO_RETENTION_HOURS * 60 * 60 * 1000;
      const candidates = await app.redis.zrangebyscore(
        target.pendingKey,
        "-inf",
        cutoff,
        "LIMIT",
        0,
        BATCH_SIZE
      );

      for (const objectKey of candidates) {
        // Fix de review (PR #96): mismo lock por key que toma `confirmPhoto()` --
        // cierra la ventana de TOCTOU entre este chequeo contra Postgres y el
        // `deleteObject` de abajo, donde una confirmación en curso podía terminar de
        // persistir `photoUrl` justo después de que el sweep ya la había leído como
        // "no confirmada" (violaba AC3: un objeto confirmado quedaba borrado igual,
        // sin ningún error visible). Si `confirmPhoto()` tiene el lock ahora mismo, se
        // salta este candidato -- no se remueve del set, así que se reevalúa en la
        // próxima corrida, ya sin disputa.
        const photoLockKey = target.keyLock(objectKey);
        const lockAcquired = await app.redis.set(photoLockKey, "1", "PX", target.keyLockTtlMs, "NX");
        if (lockAcquired !== "OK") {
          app.log.debug({ objectKey }, "Candidato del sweep omitido: confirmPhoto lo tiene lockeado ahora mismo.");
          continue;
        }

        try {
          // AC3 de MOVO-124: nunca confiar solo en que Redis diga "no confirmado" --
          // Postgres es la fuente de verdad real. Si el ZREM de confirmPhoto falló por
          // algún motivo y la key sigue acá pese a estar confirmada, se la saca del
          // tracking sin tocar el objeto de S3.
          const confirmed = await target.isConfirmed(objectKey);
          if (confirmed) {
            await app.redis.zrem(target.pendingKey, objectKey);
          } else {
            await storageProvider.deleteObject(objectKey);
            await app.redis.zrem(target.pendingKey, objectKey);
          }
          // Libera el lock apenas termina -- best-effort, si esto falla el lock igual
          // expira solo por TTL (PHOTO_CONFIRMATION_LOCK_TTL_MS) sin bloquear al
          // candidato más que unos segundos.
          await app.redis.unlink(photoLockKey);
        } catch (err) {
          // No se remueve del set en este caso -- reintenta en la próxima corrida.
          app.log.warn(
            { err, objectKey, target: target.name },
            "No se pudo procesar un candidato del sweep de fotos huérfanas"
          );
        }
      }
    } catch (err) {
      app.log.error({ err, target: target.name }, "Error inesperado durante el sweep de fotos huérfanas de S3");
    }
  };

  const runSweep = async () => {
    for (const target of targets) {
      await sweepTarget(target);
    }
  };

  const timer = setInterval(runSweep, intervalMs);

  app.addHook("onClose", async () => {
    clearInterval(timer);
  });
});
