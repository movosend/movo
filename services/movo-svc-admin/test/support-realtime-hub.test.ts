import { describe, expect, it, vi } from "vitest";
import type Redis from "ioredis";
import type { WebSocket } from "ws";
import type { FastifyBaseLogger } from "fastify";
import { SupportCounts, SupportStreamEvent, SUPPORT_EVENTS_STREAM_FIELD } from "@movo/shared";
import { createSupportRealtimeHub } from "../src/modules/support/support-realtime";
import { NameDirectory } from "../src/modules/support/support.presenter";

const COUNTS: SupportCounts = { byStatus: { open: 1, awaiting_user: 0, resolved: 0 }, byOwner: { all: 1, mine: 0, none: 1 }, unreadTotal: 1 };
const NAMES: NameDirectory = { nameOf: () => "Ana", rolesOf: () => [] };

const UPDATED: SupportStreamEvent = {
  type: "conversation_updated",
  conversation: {
    id: "c1", code: "SOP-1", userId: "u1", topic: "payments", priority: "normal", status: "open", assignedTo: null, unread: 0,
    lastMessage: null, waitMinutes: 0, shipment: null, tags: [], lastActivityAt: "2026-10-25T12:00:00.000Z",
    createdAt: "2026-10-25T12:00:00.000Z", resolvedAt: null,
  },
};

const entry = (id: string, event: SupportStreamEvent): [string, string[]] => [id, [SUPPORT_EVENTS_STREAM_FIELD, JSON.stringify(event)]];

/** Lector falso: entrega las tandas en orden y después bloquea vacío. Guarda los ids desde los que se leyó. */
function fakeReader(batches: Array<Array<[string, string[]]>>) {
  const from: string[] = [];
  const reader = {
    async xread(...args: unknown[]) {
      from.push(String(args[args.length - 1]));
      const batch = batches.shift();
      if (batch) return [["support:events", batch]];
      await new Promise((resolve) => setTimeout(resolve, 5));
      return null;
    },
    disconnect: vi.fn(),
  };
  return { reader: reader as unknown as Redis, from };
}

function fakeSocket() {
  const frames: Array<Record<string, unknown>> = [];
  const socket = { readyState: 1, send: (data: string) => frames.push(JSON.parse(data)), close: vi.fn() };
  return { socket: socket as unknown as WebSocket, frames };
}

const logger = () => ({ warn: vi.fn() }) as unknown as FastifyBaseLogger & { warn: ReturnType<typeof vi.fn> };

describe("hub del WebSocket de soporte (MOVO-322)", () => {
  it("arranca desde la última entrada que había al registrarse la primera conexión, no desde `$`", async () => {
    const { reader, from } = fakeReader([]);
    const hub = createSupportRealtimeHub({
      createReader: () => reader,
      latestEntryId: async () => "1700000000000-3",
      names: async () => NAMES,
      countsFor: async () => COUNTS,
      logger: logger(),
    });
    hub.add("admin-1", fakeSocket().socket);
    await vi.waitFor(() => expect(from[0]).toBe("1700000000000-3"));
    await hub.close();
  });

  it("los contadores de cada admin van en paralelo y con tope: uno lento no atrasa a los demás", async () => {
    const { reader } = fakeReader([[entry("1-0", UPDATED), entry("2-0", { type: "counts_changed" })]]);
    const log = logger();
    const hub = createSupportRealtimeHub({
      createReader: () => reader,
      latestEntryId: async () => "0-0",
      names: async () => NAMES,
      countsFor: (adminId) => (adminId === "slow" ? new Promise<SupportCounts>(() => undefined) : Promise.resolve(COUNTS)),
      logger: log,
      countsTimeoutMs: 50,
    });
    const fast = fakeSocket();
    const slow = fakeSocket();
    hub.add("fast", fast.socket);
    hub.add("slow", slow.socket);

    await vi.waitFor(() => expect(fast.frames).toHaveLength(2));
    await vi.waitFor(() => expect(slow.frames).toHaveLength(1));
    expect(fast.frames.map((f) => f.type)).toEqual(["conversation_updated", "counts_updated"]);
    // El lento recibe la tanda igual, sin `counts_updated` (lo pide al refrescar).
    expect(slow.frames.map((f) => f.type)).toEqual(["conversation_updated"]);
    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ event: "support_ws_counts_failed", adminId: "slow" }), expect.any(String));
    await hub.close();
  });

  it("si repartir una tanda falla, se loguea con sus ids y la siguiente llega", async () => {
    const { reader } = fakeReader([[entry("1-0", UPDATED)], [entry("2-0", UPDATED)]]);
    const log = logger();
    const names = vi.fn().mockRejectedValueOnce(new Error("roto")).mockResolvedValue(NAMES);
    const hub = createSupportRealtimeHub({
      createReader: () => reader,
      latestEntryId: async () => "0-0",
      names,
      countsFor: async () => COUNTS,
      logger: log,
    });
    const client = fakeSocket();
    hub.add("admin-1", client.socket);

    await vi.waitFor(() => expect(client.frames).toHaveLength(1));
    expect(client.frames[0]).toMatchObject({ cursor: "2-0" });
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "support_ws_dispatch_failed", firstEntryId: "1-0", lastEntryId: "1-0" }),
      expect.any(String)
    );
    expect(log.warn).not.toHaveBeenCalledWith(expect.objectContaining({ event: "support_ws_reader_failed" }), expect.any(String));
    await hub.close();
  });
});
