import type { Redis } from "ioredis";
import type { ChatPushBuffer, ChatPushBufferEntry } from "../modules/chat/chat.service";

/** Un resumen cubre como mucho los mensajes de una ventana; el tope evita crecer sin límite ante un spam. */
const MAX_BUFFERED_ENTRIES = 100;
/** Si el proceso se reinicia y nadie vacía la cola, se descarta sola. */
const BUFFER_TTL_SECONDS = 300;

const bufferKey = (shipmentId: string, userId: string) => `chat-push-buffer:${shipmentId}:${userId}`;

/**
 * MOVO-301: cola en Redis de los mensajes de chat que no avisaron por estar dentro de la ventana de
 * una conversación. Al cerrarse la ventana se vacía y sale un único resumen.
 */
export function createRedisChatPushBuffer(redis: Redis): ChatPushBuffer {
  return {
    async add(shipmentId, userId, entry) {
      const key = bufferKey(shipmentId, userId);
      await redis
        .multi()
        .rpush(key, JSON.stringify(entry))
        .ltrim(key, -MAX_BUFFERED_ENTRIES, -1)
        .expire(key, BUFFER_TTL_SECONDS)
        .exec();
    },

    async drain(shipmentId, userId) {
      const key = bufferKey(shipmentId, userId);
      const result = await redis.multi().lrange(key, 0, -1).del(key).exec();
      const raw = (result?.[0]?.[1] ?? []) as string[];
      return raw.flatMap((item) => {
        try {
          return [JSON.parse(item) as ChatPushBufferEntry];
        } catch {
          return [];
        }
      });
    },
  };
}
