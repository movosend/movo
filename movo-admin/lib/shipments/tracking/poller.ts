import type { AdminShipmentTracking } from "./types"
import { TrackingFetchError } from "./client"

/**
 * - `connecting`: primera lectura en curso.
 * - `live`: la última lectura salió bien.
 * - `reconnecting`: la última falló; se reintenta con backoff y se conserva el último dato.
 * - `paused`: pestaña oculta, no se pide nada hasta volver.
 * - `error`: respuesta 4xx; solo se vuelve a pedir manualmente.
 */
export type PollStatus =
  "connecting" | "live" | "reconnecting" | "paused" | "error"

export interface PollerDeps {
  fetchTracking: (signal: AbortSignal) => Promise<AdminShipmentTracking>
  onData: (data: AdminShipmentTracking) => void
  onStatus: (status: PollStatus, failures: number) => void
  isVisible?: () => boolean
  random?: () => number
}

export const DEFAULT_POLL_SECONDS = 15
const BACKOFF_BASE_MS = 2_000
const BACKOFF_MAX_MS = 60_000
const WAITING_POLL_MS = 60_000

/**
 * Lectura periódica del seguimiento (MOVO-328 AC5). Sin React para probarla con timers falsos.
 * El intervalo lo manda el backend (`pollIntervalSeconds`) mientras está en vivo. Los estados
 * previos se consultan cada minuto; la traza cerrada no cambia. Pestaña oculta: pausa y retoma.
 */
export class TrackingPoller {
  private timer: ReturnType<typeof setTimeout> | null = null
  private controller: AbortController | null = null
  private failures = 0
  private stopped = true
  private paused = false
  private terminalError = false

  constructor(private readonly deps: PollerDeps) {}

  start() {
    if (!this.stopped) return
    this.stopped = false
    this.terminalError = false
    this.paused = false
    this.failures = 0
    this.deps.onStatus("connecting", 0)
    void this.tick()
  }

  stop() {
    this.stopped = true
    this.clear()
  }

  /** Para el botón "Reintentar" y para cuando la pestaña vuelve a estar visible. */
  refresh() {
    if (this.stopped) return
    this.clear()
    this.paused = false
    this.terminalError = false
    this.failures = 0
    this.deps.onStatus("connecting", 0)
    void this.tick()
  }

  visibilityChanged() {
    if (this.stopped || this.terminalError) return
    const visible = this.deps.isVisible?.() ?? true
    if (!visible) {
      this.clear()
      this.paused = true
      this.deps.onStatus("paused", this.failures)
    } else if (this.paused) this.refresh()
  }

  private clear() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.controller?.abort()
    this.controller = null
  }

  private schedule(ms: number) {
    if (this.stopped) return
    this.timer = setTimeout(() => void this.tick(), ms)
  }

  private async tick() {
    this.timer = null
    if (this.stopped) return
    if (!(this.deps.isVisible?.() ?? true)) {
      this.paused = true
      this.deps.onStatus("paused", this.failures)
      return
    }
    const controller = new AbortController()
    this.controller = controller
    try {
      const data = await this.deps.fetchTracking(controller.signal)
      if (this.stopped || controller.signal.aborted) return
      this.failures = 0
      this.deps.onData(data)
      this.deps.onStatus("live", 0)
      if (data.state === "live")
        this.schedule((data.pollIntervalSeconds || DEFAULT_POLL_SECONDS) * 1000)
      else if (data.state !== "closed") this.schedule(WAITING_POLL_MS)
    } catch (error) {
      if (this.stopped || controller.signal.aborted) return
      if (
        error instanceof TrackingFetchError &&
        error.status >= 400 &&
        error.status < 500
      ) {
        this.terminalError = true
        this.deps.onStatus("error", this.failures)
        return
      }
      this.failures += 1
      this.deps.onStatus("reconnecting", this.failures)
      const jitter = 0.5 + (this.deps.random?.() ?? Math.random()) * 0.5
      this.schedule(
        Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (this.failures - 1)) *
          jitter
      )
    }
  }
}
