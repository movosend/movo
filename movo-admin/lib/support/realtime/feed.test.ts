import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type {
  SupportEvent,
  SupportEventsPage,
  SupportRealtimeTicket,
} from "@movo/shared/src/types/admin-support"
import { SUPPORT_WS_CLOSE } from "@movo/shared/src/types/support"
import {
  POLL_MS,
  SupportFeed,
  WS_FAILURES_BEFORE_POLLING,
  WS_STABLE_MS,
  type FeedMessage,
  type SocketLike,
} from "./feed"

class FakeSocket implements SocketLike {
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: ((event?: { code?: number }) => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  close() {
    this.closed = true
  }
}

const ticket: SupportRealtimeTicket = {
  ticket: "t",
  url: "wss://x",
  expiresAt: "",
}
const event = (cursor: string): SupportEvent => ({
  type: "counts_updated",
  cursor,
  counts: {
    byStatus: { open: 1, awaiting_user: 0, resolved: 0 },
    byOwner: { all: 1, mine: 0, none: 1 },
    unreadTotal: 1,
  },
})

function setup(
  over: {
    ticket?: () => Promise<SupportRealtimeTicket | null>
    events?: (since: string | undefined) => Promise<SupportEventsPage | null>
  } = {}
) {
  const sockets: FakeSocket[] = []
  const fetchEvents = vi.fn(
    over.events ?? (async () => ({ events: [], cursor: "0", reset: false }))
  )
  const feed = new SupportFeed({
    requestTicket: over.ticket ?? (async () => ticket),
    openSocket: () => {
      const s = new FakeSocket()
      sockets.push(s)
      return s
    },
    fetchEvents,
    random: () => 1,
  })
  const messages: FeedMessage[] = []
  feed.subscribe((m) => messages.push(m))
  return { feed, sockets, messages, fetchEvents }
}
const flush = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() =>
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  })
)
afterEach(() => vi.useRealTimers())

describe("SupportFeed", () => {
  it("abre el WS, pasa a live, pide resync y entrega los eventos JSON", async () => {
    const { feed, sockets, messages } = setup()
    feed.start()
    await flush()
    sockets[0].onopen?.()
    expect(feed.status).toBe("live")
    sockets[0].onmessage?.({ data: JSON.stringify(event("5")) })
    sockets[0].onmessage?.({ data: "basura" })
    expect(messages).toEqual([
      { type: "resync" },
      { type: "event", event: event("5") },
    ])
  })

  it("reconecta con backoff y avisa resync al volver", async () => {
    const { feed, sockets, messages } = setup()
    feed.start()
    await flush()
    sockets[0].onopen?.()
    sockets[0].onclose?.()
    expect(feed.status).toBe("reconnecting")
    await vi.advanceTimersByTimeAsync(1_000)
    expect(sockets).toHaveLength(2)
    sockets[1].onopen?.()
    expect(feed.status).toBe("live")
    expect(messages).toContainEqual({ type: "resync" })
  })

  it("cuenta onerror y onclose del mismo socket como un solo fallo", async () => {
    const { feed, sockets } = setup()
    feed.start()
    await flush()
    const error = sockets[0].onerror
    const close = sockets[0].onclose
    error?.()
    close?.()
    expect(sockets[0].closed).toBe(true)
    expect(feed.status).toBe("reconnecting")
    await vi.advanceTimersByTimeAsync(1_000)
    expect(sockets).toHaveLength(2)
    sockets[1].onerror?.()
    sockets[1].onclose?.()
    expect(feed.status).toBe("reconnecting")
    await vi.advanceTimersByTimeAsync(2_000)
    expect(sockets).toHaveLength(3)
    expect(feed.status).toBe("reconnecting")
    sockets[2].onerror?.()
    sockets[2].onclose?.()
    expect(feed.status).toBe("polling")
    feed.stop()
  })

  it("cae a polling tras fallos seguidos y sigue leyendo desde el cursor", async () => {
    const events = vi.fn(
      async (since: string | undefined): Promise<SupportEventsPage | null> => ({
        events: since ? [] : [event("7")],
        cursor: "7",
        reset: false,
      })
    )
    const { feed, messages } = setup({ ticket: async () => null, events })
    feed.start()
    for (let i = 0; i < WS_FAILURES_BEFORE_POLLING; i++)
      await vi.advanceTimersByTimeAsync(40_000)
    expect(feed.status).toBe("polling")
    expect(messages.some((m) => m.type === "event")).toBe(true)
    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(events).toHaveBeenLastCalledWith("7")
  })

  it("un reset del servidor pide resync", async () => {
    const events = async () => ({ events: [], cursor: "9", reset: true })
    const { feed, messages } = setup({ ticket: async () => null, events })
    feed.start()
    for (let i = 0; i < WS_FAILURES_BEFORE_POLLING; i++)
      await vi.advanceTimersByTimeAsync(40_000)
    expect(messages).toContainEqual({ type: "resync" })
  })

  it("stop cierra el socket y no reintenta", async () => {
    const { feed, sockets } = setup()
    feed.start()
    await flush()
    feed.stop()
    expect(sockets[0].closed).toBe(true)
    expect(feed.status).toBe("stopped")
    await vi.advanceTimersByTimeAsync(60_000)
    expect(sockets).toHaveLength(1)
  })

  describe("MOVO-346: servidor que acepta y cierra enseguida", () => {
    it("el backoff crece y pasa a polling al 3.er intento aunque cada socket abra", async () => {
      const ticketCalls = vi.fn(async () => ticket)
      const { feed, sockets } = setup({ ticket: ticketCalls })
      feed.start()
      await flush()
      for (let i = 0; i < WS_FAILURES_BEFORE_POLLING; i++) {
        sockets[i].onopen?.()
        sockets[i].onclose?.()
        if (i < WS_FAILURES_BEFORE_POLLING - 1) {
          expect(feed.status).toBe("reconnecting")
          // Sin reset en onopen: el segundo intento espera 2 s, no 1 s.
          await vi.advanceTimersByTimeAsync(1_000 * 2 ** i)
        }
      }
      expect(feed.status).toBe("polling")
      expect(ticketCalls).toHaveBeenCalledTimes(WS_FAILURES_BEFORE_POLLING)
      feed.stop()
    })

    it("con el socket estable un rato, el backoff vuelve a empezar", async () => {
      const { feed, sockets } = setup()
      feed.start()
      await flush()
      sockets[0].onclose?.()
      await vi.advanceTimersByTimeAsync(1_000)
      sockets[1].onopen?.()
      await vi.advanceTimersByTimeAsync(WS_STABLE_MS)
      sockets[1].onclose?.()
      await vi.advanceTimersByTimeAsync(1_000)
      expect(sockets).toHaveLength(3)
      feed.stop()
    })

    it("un cierre FORBIDDEN pasa directo a polling y no vuelve a pedir tickets", async () => {
      const ticketCalls = vi.fn(async () => ticket)
      const { feed, sockets, fetchEvents } = setup({ ticket: ticketCalls })
      feed.start()
      await flush()
      sockets[0].onopen?.()
      sockets[0].onclose?.({ code: SUPPORT_WS_CLOSE.FORBIDDEN })
      expect(feed.status).toBe("polling")
      await vi.advanceTimersByTimeAsync(5 * 60_000)
      expect(ticketCalls).toHaveBeenCalledTimes(1)
      expect(fetchEvents).toHaveBeenCalled()
      feed.stop()
    })
  })
})
