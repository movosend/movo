import {
  SUPPORT_WS_PROTOCOL,
  type SupportEvent,
  type SupportEventsPage,
  type SupportRealtimeTicket,
} from "@movo/shared/src/types/admin-support"
import type { SocketLike } from "./feed"

/** Prefijo del `url` del ticket en el modo fixtures: no hay WS real, se simula leyendo `events`. */
export const MOCK_SOCKET_URL = "mock://support"
const MOCK_POLL_MS = 1_500

/**
 * WS simulado del modo fixtures: se comporta como un WebSocket (abre, entrega mensajes JSON,
 * cierra) pero lee los eventos del store del servidor de desarrollo. Sirve para ejercitar el mismo
 * camino que el WS real. Si la lectura falla varias veces, cierra como lo haría un WS caído.
 */
class MockSocket implements SocketLike {
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private cursor: string | undefined
  private closed = false
  private misses = 0

  constructor(
    private readonly fetchEvents: (
      since: string | undefined
    ) => Promise<SupportEventsPage | null>
  ) {
    queueMicrotask(() => {
      if (this.closed) return
      this.onopen?.()
      void this.tick()
      this.timer = setInterval(() => void this.tick(), MOCK_POLL_MS)
    })
  }

  private async tick() {
    if (this.closed) return
    const page = await this.fetchEvents(this.cursor).catch(() => null)
    if (this.closed) return
    if (!page) {
      if (++this.misses >= 2) this.drop()
      return
    }
    this.misses = 0
    this.cursor = page.cursor
    for (const event of page.events as SupportEvent[])
      this.onmessage?.({ data: JSON.stringify(event) })
  }

  private drop() {
    this.close()
    this.onclose?.()
  }

  close() {
    this.closed = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}

/** Adaptador del `WebSocket` nativo a la interfaz mínima del feed. */
class NativeSocket implements SocketLike {
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  private readonly ws: WebSocket

  constructor(url: string, protocols: string[]) {
    this.ws = new WebSocket(url, protocols)
    this.ws.onopen = () => this.onopen?.()
    this.ws.onmessage = (event) => this.onmessage?.({ data: event.data })
    this.ws.onclose = () => this.onclose?.()
    this.ws.onerror = () => this.onerror?.()
  }

  close() {
    this.ws.onopen =
      this.ws.onmessage =
      this.ws.onclose =
      this.ws.onerror =
        null
    this.ws.close()
  }
}

/** Abre el WS real del panel con el ticket de un solo uso en el subprotocolo (nunca en la URL). */
export function openSupportSocket(
  ticket: SupportRealtimeTicket,
  fetchEvents: (since: string | undefined) => Promise<SupportEventsPage | null>
): SocketLike {
  if (ticket.url === MOCK_SOCKET_URL) return new MockSocket(fetchEvents)
  const url = new URL(ticket.url)
  if (url.protocol !== "wss:" && url.protocol !== "ws:")
    throw new Error("Invalid support WebSocket protocol")
  return new NativeSocket(ticket.url, [SUPPORT_WS_PROTOCOL, ticket.ticket])
}
