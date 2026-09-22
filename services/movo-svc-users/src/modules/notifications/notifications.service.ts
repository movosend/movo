import { FastifyBaseLogger } from "fastify";
import { PrismaClient } from "../../generated/prisma/client";
import { createPushTokenRepository } from "../../repositories/push-token-repository";
import { PushNotificationProvider } from "../../adapters/push-notification-provider";
import { createNotificationPreferenceRepository } from "../../repositories/notification-preference-repository";
import { getNotificationCategory, isWithinQuietHours, toArgentinaTimeOfDayString, NotificationCategoryId } from "@movo/shared";

export interface SendPushInput {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /**
   * MOVO-245 (AC1/AC2): toda categoría es obligatoria -- ningún trigger nuevo puede
   * mandar push "sin declarar" a qué categoría pertenece, así el enforcement de acá
   * abajo nunca queda salteado por un caller que se olvidó de pasarla. Debe ser una
   * de `NOTIFICATION_CATEGORIES` (@movo/shared) -- una categoría desconocida se trata
   * como "sin preferencia configurable" y NO se envía (fail-closed, no fail-open: más
   * seguro dejar de mandar un push nuevo mal cableado que mandarlo sin poder
   * respetar el toggle del usuario).
   */
  category: NotificationCategoryId;
}

export function createNotificationsService(
  db: PrismaClient,
  pushProvider: PushNotificationProvider,
  logger: FastifyBaseLogger
) {
  const pushTokenRepository = createPushTokenRepository(db);
  const preferenceRepository = createNotificationPreferenceRepository(db);

  /**
   * AC1/AC2/AC3 de MOVO-245: único punto de decisión de "¿se manda o no?" -- lo
   * respeta el servidor, no el cliente. Chequea en orden: categoría conocida →
   * toggle maestro → toggle de categoría → horario de silencio (salvo excepción por
   * categoría). Cualquier `false` corta acá, antes de tocar el provider.
   */
  async function isPushAllowed(userId: string, category: string): Promise<boolean> {
    const categoryDef = getNotificationCategory(category);
    if (!categoryDef || !categoryDef.implemented) {
      logger.warn({ userId, category, event: "push_unknown_category" }, "sendPushToUser con categoría desconocida -- no se envía");
      return false;
    }

    const [prefs, overrides] = await Promise.all([
      preferenceRepository.getPreferences(userId),
      preferenceRepository.getCategoryOverrides(userId),
    ]);

    if (!prefs.pushEnabled) return false;

    const categoryEnabled = overrides.get(category) ?? true;
    if (!categoryEnabled) return false;

    if (prefs.quietHoursEnabled && !categoryDef.quietHoursExempt) {
      const now = toArgentinaTimeOfDayString(new Date());
      if (isWithinQuietHours(now, prefs.quietHoursFrom, prefs.quietHoursTo)) return false;
    }

    return true;
  }

  return {
    /** AC6: envía a todos los dispositivos registrados del usuario. Un token
     * individual que falla (inválido/expirado, proveedor caído a medias) se loguea y
     * no aborta el resto — `Promise.allSettled`, no `Promise.all`. Con 0 tokens
     * registrados, no-op silencioso: no es un error, el usuario simplemente no tiene
     * push habilitado. */
    async sendPushToUser(userId: string, input: SendPushInput): Promise<void> {
      const allowed = await isPushAllowed(userId, input.category);
      if (!allowed) {
        return;
      }

      const tokens = await pushTokenRepository.findAllByUserId(userId);
      if (tokens.length === 0) {
        return;
      }

      const results = await Promise.allSettled(
        tokens.map((token) =>
          pushProvider.send({
            expoPushToken: token.expoPushToken,
            title: input.title,
            body: input.body,
            ...(input.data !== undefined ? { data: input.data } : {}),
          })
        )
      );

      results.forEach((result, index) => {
        if (result.status === "rejected") {
          const token = tokens[index];
          if (!token) {
            return;
          }
          logger.warn(
            {
              userId,
              deviceId: token.deviceId,
              event: "push_send_failed",
              error: result.reason instanceof Error ? result.reason.message : String(result.reason),
            },
            "No se pudo enviar la push notification a un dispositivo"
          );
        }
      });
    },
  };
}
