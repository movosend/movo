import { FastifyBaseLogger } from "fastify";
import { PrismaClient } from "../../generated/prisma/client";
import { createPushTokenRepository } from "../../repositories/push-token-repository";
import { PushNotificationProvider } from "../../adapters/push-notification-provider";

export interface SendPushInput {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export function createNotificationsService(
  db: PrismaClient,
  pushProvider: PushNotificationProvider,
  logger: FastifyBaseLogger
) {
  const pushTokenRepository = createPushTokenRepository(db);

  return {
    /** AC6: envía a todos los dispositivos registrados del usuario. Un token
     * individual que falla (inválido/expirado, proveedor caído a medias) se loguea y
     * no aborta el resto — `Promise.allSettled`, no `Promise.all`. Con 0 tokens
     * registrados, no-op silencioso: no es un error, el usuario simplemente no tiene
     * push habilitado. */
    async sendPushToUser(userId: string, input: SendPushInput): Promise<void> {
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
