import type Redis from "ioredis";
import {
  ApiError,
  SupportCounts,
  SupportEvent,
  SupportEventsPage,
  SupportStreamEvent,
  SUPPORT_EVENTS_STREAM_FIELD,
  SUPPORT_EVENTS_STREAM_KEY,
} from "@movo/shared";
import { messageNameIds, NameDirectory, rowNameIds, toMessage, toRow } from "./support.presenter";

/** Tope de eventos por página de `GET /admin/support/events`; el resto sale en la siguiente. */
const EVENTS_PAGE_SIZE = 200;
const STREAM_ID_RE = /^\d+-\d+$/;

export interface StreamEntry {
  id: string;
  event: SupportStreamEvent;
}

/** Compara dos ids de Redis Stream (`<ms>-<seq>`). */
function compareStreamIds(a: string, b: string): number {
  const [aMs, aSeq] = a.split("-").map(BigInt);
  const [bMs, bSeq] = b.split("-").map(BigInt);
  if (aMs !== bMs) return aMs < bMs ? -1 : 1;
  if (aSeq !== bSeq) return aSeq < bSeq ? -1 : 1;
  return 0;
}

export function parseEntries(raw: Array<[string, string[]]>): StreamEntry[] {
  return raw.flatMap(([id, fields]) => {
    const index = fields.indexOf(SUPPORT_EVENTS_STREAM_FIELD);
    if (index === -1) return [];
    try {
      return [{ id, event: JSON.parse(fields[index + 1]) as SupportStreamEvent }];
    } catch {
      return [];
    }
  });
}

/**
 * MOVO-322 (ADR-056): lectura del Redis Stream `support:events` que escribe `svc-shipments`. El id de la entrada es el
 * cursor del panel (monótono y opaco para el cliente). El stream se recorta (`MAXLEN ~`): si el cursor del panel es más
 * viejo que la primera entrada que queda, se pudieron perder eventos y la respuesta es `reset: true` (el panel vuelve
 * a pedir lista, contadores y mensajes).
 */
export async function readStream(
  redis: Redis,
  since: string | undefined
): Promise<{ entries: StreamEntry[]; cursor: string; reset: boolean }> {
  if (!since) {
    // Sin cursor arranca desde ahora: el panel ya pidió la lista.
    const last = await redis.xrevrange(SUPPORT_EVENTS_STREAM_KEY, "+", "-", "COUNT", 1);
    return { entries: [], cursor: last[0]?.[0] ?? "0-0", reset: false };
  }
  if (!STREAM_ID_RE.test(since)) throw new ApiError(400, "VALIDATION_FAILED", "Cursor de eventos inválido.");
  const first = await redis.xrange(SUPPORT_EVENTS_STREAM_KEY, "-", "+", "COUNT", 1);
  if (first[0] && since !== "0-0" && compareStreamIds(since, first[0][0]) < 0) {
    const last = await redis.xrevrange(SUPPORT_EVENTS_STREAM_KEY, "+", "-", "COUNT", 1);
    return { entries: [], cursor: last[0]?.[0] ?? since, reset: true };
  }
  const raw = await redis.xrange(SUPPORT_EVENTS_STREAM_KEY, `(${since}`, "+", "COUNT", EVENTS_PAGE_SIZE);
  const entries = parseEntries(raw);
  return { entries, cursor: raw.length > 0 ? raw[raw.length - 1][0] : since, reset: false };
}

/** Ids cuyos nombres hacen falta para presentar estas entradas. */
export function entryNameIds(entries: StreamEntry[]): string[] {
  return entries.flatMap(({ event }) =>
    event.type === "counts_changed"
      ? []
      : [...rowNameIds(event.conversation), ...(event.type === "support_message" ? messageNameIds(event.message) : [])]
  );
}

/**
 * Entradas del stream → eventos del panel. Los `counts_changed` se juntan en un solo `counts_updated` (en la posición del
 * último), con los contadores de quien mira: `byOwner.mine` depende del admin, por eso no viajan en el stream.
 */
export function toPanelEvents(entries: StreamEntry[], names: NameDirectory, counts: SupportCounts | null): SupportEvent[] {
  const lastCounts = entries.map((e) => e.event.type).lastIndexOf("counts_changed");
  return entries.flatMap(({ id: cursor, event }, index): SupportEvent[] => {
    switch (event.type) {
      case "conversation_created":
        return [{ type: "conversation_created", cursor, conversation: toRow(event.conversation, names) }];
      case "conversation_updated":
        return [{ type: "conversation_updated", cursor, conversation: toRow(event.conversation, names) }];
      case "support_message":
        return [
          {
            type: "support_message",
            cursor,
            conversationId: event.conversation.id,
            message: toMessage(event.message, names),
            conversation: toRow(event.conversation, names),
          },
        ];
      case "counts_changed":
        return index === lastCounts && counts ? [{ type: "counts_updated", cursor, counts }] : [];
    }
  });
}

export type { SupportEventsPage };
