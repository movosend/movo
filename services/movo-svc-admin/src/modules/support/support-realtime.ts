import { createHash, randomBytes } from "node:crypto";
import type Redis from "ioredis";
import type { WebSocket } from "ws";
import { FastifyBaseLogger } from "fastify";
import { SupportCounts, SUPPORT_EVENTS_STREAM_KEY, SUPPORT_WS_PROTOCOL } from "@movo/shared";
import { RequestContext } from "../../adapters/internal-client";
import { entryNameIds, parseEntries, toPanelEvents } from "./support-events";
import { NameDirectory } from "./support.presenter";

/** Vida del ticket del WebSocket del panel: alcanza para que el navegador abra la conexión, no para reusarlo. */
export const SUPPORT_TICKET_TTL_SECONDS = 30;
/** Header con la lista original de subprotocolos que reenvía el gateway (ver `gateway/src/routes/index.ts`). */
export const FORWARDED_WS_PROTOCOLS_HEADER = "x-ws-protocols";

const ticketKey = (ticket: string) => `support-ws-ticket:${createHash("sha256").update(ticket).digest("hex")}`;

/**
 * MOVO-322: tickets de un solo uso del WebSocket del panel. Se guarda solo el sha256 (un volcado de Redis no da
 * tickets usables), atado al admin que lo pidió con su sesión, y se gasta con `GETDEL`: dos conexiones con el mismo
 * ticket no pueden ganar las dos.
 */
export function createSupportTicketStore(redis: Redis) {
  return {
    async issue(adminId: string, now: Date): Promise<{ ticket: string; expiresAt: string }> {
      const ticket = randomBytes(32).toString("base64url");
      await redis.set(ticketKey(ticket), adminId, "EX", SUPPORT_TICKET_TTL_SECONDS);
      return { ticket, expiresAt: new Date(now.getTime() + SUPPORT_TICKET_TTL_SECONDS * 1000).toISOString() };
    },
    async consume(ticket: string): Promise<string | null> {
      return redis.getdel(ticketKey(ticket));
    },
  };
}

/**
 * El ticket viaja como segundo subprotocolo (`movo-support.v1, <ticket>`). Detrás del gateway llega en
 * `x-ws-protocols` (el gateway solo le pasa al upstream el primero); directo, en `sec-websocket-protocol`.
 */
export function ticketFromHeaders(headers: Record<string, string | string[] | undefined>): string | null {
  const raw = headers[FORWARDED_WS_PROTOCOLS_HEADER] ?? headers["sec-websocket-protocol"];
  if (typeof raw !== "string") return null;
  const [protocol, ticket, ...rest] = raw.split(",").map((p) => p.trim());
  return protocol === SUPPORT_WS_PROTOCOL && ticket && rest.length === 0 ? ticket : null;
}

/**
 * `Origin` del navegador contra la lista permitida (`SUPPORT_WS_ALLOWED_ORIGINS`, separada por coma). `*` es comodín
 * de un tramo sin puntos (`https://movo-admin-git-*-movoteamprojects.vercel.app`). Sin `Origin` (un cliente que no es
 * navegador) no pasa: el panel siempre lo manda.
 */
export function originAllowed(origin: string | undefined, allowlist: string): boolean {
  if (!origin) return false;
  return allowlist
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .some((entry) => {
      const pattern = entry.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^./]+");
      return new RegExp(`^${pattern}$`).test(origin);
    });
}

const WS_READY_STATE_OPEN = 1;

export interface SupportRealtimeHubDeps {
  /** Conexión propia para `XREAD BLOCK` (bloquea la conexión mientras espera). */
  createReader: () => Redis;
  names: (ids: string[], ctx: RequestContext) => Promise<NameDirectory>;
  countsFor: (adminId: string, ctx: RequestContext) => Promise<SupportCounts>;
  logger: FastifyBaseLogger;
  /** Cuánto espera cada `XREAD` antes de volver a mirar si sigue habiendo conexiones. */
  blockMs?: number;
}

/**
 * MOVO-322 (ADR-056): reparte los eventos del Redis Stream `support:events` a los agentes conectados. Un solo lector
 * para todas las conexiones (mientras haya alguna): por cada tanda arma los eventos del panel con los nombres de una
 * sola consulta a `svc-users` y, si hubo `counts_changed`, los contadores de cada admin (`byOwner.mine` es suyo).
 * Los agentes reciben todo, notas incluidas. En memoria y con una sola réplica, como el `ChatHub` (ADR-022): un panel
 * que se reconecta vuelve a pedir lista, contadores y mensajes, así que no hace falta reenviar lo que pasó sin él.
 */
export function createSupportRealtimeHub(deps: SupportRealtimeHubDeps) {
  const sockets = new Map<string, Set<WebSocket>>();
  const blockMs = deps.blockMs ?? 5000;
  let reader: Redis | null = null;
  let running = false;
  let closed = false;

  const total = () => [...sockets.values()].reduce((n, set) => n + set.size, 0);

  async function dispatch(raw: Array<[string, string[]]>): Promise<void> {
    const entries = parseEntries(raw);
    if (entries.length === 0) return;
    const ctx = { requestId: `support-ws-${entries[entries.length - 1].id}` };
    const names = await deps.names(entryNameIds(entries), ctx);
    const hasCounts = entries.some((entry) => entry.event.type === "counts_changed");
    for (const [adminId, set] of sockets) {
      let counts: SupportCounts | null = null;
      if (hasCounts) {
        try {
          counts = await deps.countsFor(adminId, ctx);
        } catch (err) {
          deps.logger.warn({ err, event: "support_ws_counts_failed" }, "No se pudieron calcular los contadores del panel");
        }
      }
      const frames = toPanelEvents(entries, names, counts).map((event) => JSON.stringify(event));
      for (const socket of set) {
        if (socket.readyState !== WS_READY_STATE_OPEN) continue;
        for (const frame of frames) socket.send(frame);
      }
    }
  }

  async function loop(): Promise<void> {
    reader ??= deps.createReader();
    // `$`: desde ahora. Después, desde la última entrada repartida (el cursor del stream).
    let lastId = "$";
    while (running && !closed) {
      try {
        const result = (await reader.xread("BLOCK", blockMs, "STREAMS", SUPPORT_EVENTS_STREAM_KEY, lastId)) as
          | Array<[string, Array<[string, string[]]>]>
          | null;
        const batch = result?.[0]?.[1] ?? [];
        if (batch.length > 0) {
          lastId = batch[batch.length - 1][0];
          await dispatch(batch);
        }
      } catch (err) {
        if (closed) return;
        deps.logger.warn({ err, event: "support_ws_reader_failed" }, "Falló la lectura del stream de soporte; se reintenta");
        await new Promise((resolve) => setTimeout(resolve, 1000).unref());
      }
      if (total() === 0) running = false;
    }
  }

  return {
    add(adminId: string, socket: WebSocket): void {
      const set = sockets.get(adminId) ?? new Set<WebSocket>();
      set.add(socket);
      sockets.set(adminId, set);
      if (!running && !closed) {
        running = true;
        void loop();
      }
    },
    remove(adminId: string, socket: WebSocket): void {
      const set = sockets.get(adminId);
      if (!set) return;
      set.delete(socket);
      if (set.size === 0) sockets.delete(adminId);
    },
    connections: total,
    async close(): Promise<void> {
      closed = true;
      running = false;
      for (const set of sockets.values()) for (const socket of set) socket.close(1001, "El servicio se está reiniciando.");
      sockets.clear();
      reader?.disconnect();
    },
  };
}

export type SupportRealtimeHub = ReturnType<typeof createSupportRealtimeHub>;
