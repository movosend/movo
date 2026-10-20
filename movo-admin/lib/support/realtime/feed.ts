import type {
  SupportEvent,
  SupportEventsPage,
  SupportRealtimeTicket,
} from "@movo/shared/src/types/admin-support"

/**
 * Estado de la conexión en vivo de la bandeja.
 * - `connecting`: abriendo el WS (primer intento).
 * - `live`: WS abierto.
 * - `reconnecting`: se cayó y se reintenta; los eventos se recuperan con `resync` al volver.
 * - `polling`: el WS no pudo abrirse varias veces seguidas; se lee `GET …/events` cada
 *   `POLL_MS` y se sigue intentando el WS en segundo plano.
 * - `stopped`: sin sesión o sin suscriptores.
 */
export type FeedStatus =
  | "connecting"
  | "live"
  | "reconnecting"
  | "polling"
  | "stopped"

export type FeedMessage =
  | { type: "event"; event: SupportEvent }
  | { type: "resync" }

/** Lo mínimo de un `WebSocket` que usa el feed (así se prueba y se reemplaza por el simulado). */
export interface SocketLike {
  onopen: (() => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: (() => void) | null
  onerror: (() => void) | null
  close(): void
}

export interface FeedDeps {
  requestTicket: () => Promise<SupportRealtimeTicket | null>
  openSocket: (ticket: SupportRealtimeTicket) => SocketLike
  fetchEvents: (since: string | undefined) => Promise<SupportEventsPage | null>
  isVisible?: () => boolean
  random?: () => number
}

export const POLL_MS = 10_000
/** Fallos seguidos del WS antes de pasar a polling. */
export const WS_FAILURES_BEFORE_POLLING = 3
const BACKOFF_BASE_MS = 1_000
const BACKOFF_MAX_MS = 30_000

/**
 * Conexión en vivo con reconexión (AC9 y AC14 de MOVO-323). Sin React: el provider la usa y los
 * tests la manejan con timers falsos. El WS se autentica con un ticket de un solo uso pedido por
 * Server Action (el token nunca llega al JS); si no hay WS, cae a polling del mismo contrato de
 * eventos. Cada vez que se recupera la conexión emite `resync`: los que muestran listas deben
 * volver a pedirlas, porque pudieron perderse eventos.
 */
export class SupportFeed {
  status: FeedStatus = "stopped"
  private listeners = new Set<(m: FeedMessage) => void>()
  private statusListeners = new Set<(s: FeedStatus) => void>()
  private socket: SocketLike | null = null
  private cursor: string | undefined
  private failures = 0
  private retry: ReturnType<typeof setTimeout> | null = null
  private poll: ReturnType<typeof setInterval> | null = null
  private running = false
  /** Cambia con cada `start`/`stop` para descartar respuestas de una conexión vieja. */
  private epoch = 0
  private lost = false

  constructor(private readonly deps: FeedDeps) {}

  subscribe(listener: (m: FeedMessage) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onStatus(listener: (s: FeedStatus) => void): () => void {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  start() {
    if (this.running) return
    this.running = true
    this.epoch++
    this.failures = 0
    this.setStatus("connecting")
    void this.connect()
  }

  stop() {
    this.running = false
    this.epoch++
    this.teardown()
    this.setStatus("stopped")
  }

  private setStatus(status: FeedStatus) {
    if (this.status === status) return
    this.status = status
    for (const listener of this.statusListeners) listener(status)
  }

  private emit(message: FeedMessage) {
    for (const listener of this.listeners) listener(message)
  }

  private teardown() {
    if (this.retry) clearTimeout(this.retry)
    if (this.poll) clearInterval(this.poll)
    this.retry = null
    this.poll = null
    if (this.socket) {
      this.socket.onopen = this.socket.onmessage = this.socket.onclose = this.socket.onerror = null
      this.socket.close()
      this.socket = null
    }
  }

  private async connect() {
    const epoch = this.epoch
    let ticket: SupportRealtimeTicket | null = null
    try {
      ticket = await this.deps.requestTicket()
    } catch {
      ticket = null
    }
    if (epoch !== this.epoch || !this.running) return
    if (!ticket) return this.failed()
    let socket: SocketLike
    try {
      socket = this.deps.openSocket(ticket)
    } catch {
      return this.failed()
    }
    this.socket = socket
    socket.onopen = () => {
      if (epoch !== this.epoch) return
      this.failures = 0
      if (this.poll) clearInterval(this.poll)
      this.poll = null
      this.setStatus("live")
      if (this.lost) this.emit({ type: "resync" })
      this.lost = false
    }
    socket.onmessage = ({ data }) => {
      if (epoch !== this.epoch) return
      const event = parse(data)
      if (!event) return
      this.cursor = event.cursor
      this.emit({ type: "event", event })
    }
    const down = () => {
      if (epoch !== this.epoch || !this.running) return
      this.socket = null
      this.failed()
    }
    socket.onclose = down
    socket.onerror = down
  }

  private failed() {
    this.failures++
    this.lost = true
    this.teardownSocketOnly()
    if (this.failures >= WS_FAILURES_BEFORE_POLLING) {
      this.setStatus("polling")
      this.startPolling()
    } else {
      this.setStatus("reconnecting")
    }
    const random = this.deps.random ?? Math.random
    const delay = Math.min(
      BACKOFF_MAX_MS,
      BACKOFF_BASE_MS * 2 ** (this.failures - 1)
    )
    const epoch = this.epoch
    this.retry = setTimeout(() => {
      if (epoch === this.epoch && this.running) void this.connect()
    }, delay * (0.5 + random() * 0.5))
  }

  private teardownSocketOnly() {
    if (this.retry) clearTimeout(this.retry)
    this.retry = null
    if (this.socket) {
      this.socket.onopen = this.socket.onmessage = this.socket.onclose = this.socket.onerror = null
      this.socket.close()
      this.socket = null
    }
  }

  private startPolling() {
    if (this.poll) return
    const epoch = this.epoch
    const tick = async () => {
      if (this.deps.isVisible && !this.deps.isVisible()) return
      let page: SupportEventsPage | null = null
      try {
        page = await this.deps.fetchEvents(this.cursor)
      } catch {
        page = null
      }
      if (epoch !== this.epoch || !page) return
      const first = this.cursor === undefined
      this.cursor = page.cursor
      if (page.reset || (first && this.lost)) this.emit({ type: "resync" })
      for (const event of page.events) this.emit({ type: "event", event })
    }
    void tick()
    this.poll = setInterval(tick, POLL_MS)
  }
}

function parse(data: unknown): SupportEvent | null {
  try {
    const value = typeof data === "string" ? JSON.parse(data) : data
    if (
      value &&
      typeof value === "object" &&
      typeof (value as { type?: unknown }).type === "string" &&
      typeof (value as { cursor?: unknown }).cursor === "string"
    )
      return value as SupportEvent
  } catch {
    // Mensaje que no es JSON: se ignora.
  }
  return null
}
