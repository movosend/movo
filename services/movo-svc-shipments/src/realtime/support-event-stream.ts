import type Redis from "ioredis";
import {
  SupportStreamEvent,
  SUPPORT_EVENTS_STREAM_FIELD,
  SUPPORT_EVENTS_STREAM_KEY,
  SUPPORT_EVENTS_STREAM_MAXLEN,
} from "@movo/shared";

/**
 * MOVO-322 (ADR-056): escribe los eventos de soporte para el panel en el Redis Stream `support:events`, que lee
 * `svc-admin` (WebSocket del panel y `GET /admin/support/events`). Primera comunicación asíncrona entre servicios: no
 * es un broker ni una cola de trabajo, es un registro corto (`MAXLEN ~`) que hace de cursor para el panel. El id de
 * la entrada (`<ms>-<seq>`) es monótono, que es lo que pide el cursor de `GET events`.
 */
export interface SupportEventStream {
  publish(event: SupportStreamEvent): Promise<void>;
}

export function createRedisSupportEventStream(redis: Redis): SupportEventStream {
  return {
    async publish(event) {
      await redis.xadd(
        SUPPORT_EVENTS_STREAM_KEY,
        "MAXLEN",
        "~",
        SUPPORT_EVENTS_STREAM_MAXLEN,
        "*",
        SUPPORT_EVENTS_STREAM_FIELD,
        JSON.stringify(event)
      );
    },
  };
}
