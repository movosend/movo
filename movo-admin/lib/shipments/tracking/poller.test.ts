import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TrackingPoller, type PollStatus } from "./poller"
import type { AdminShipmentTracking } from "./types"

const data = (over: Partial<AdminShipmentTracking> = {}) =>
  ({ state: "live", pollIntervalSeconds: 15, ...over }) as AdminShipmentTracking

function setup(fetchTracking: () => Promise<AdminShipmentTracking>) {
  let visible = true
  const statuses: PollStatus[] = []
  const onData = vi.fn()
  const poller = new TrackingPoller({
    fetchTracking,
    onData,
    onStatus: (s) => statuses.push(s),
    isVisible: () => visible,
    random: () => 1,
  })
  return { poller, statuses, onData, setVisible: (v: boolean) => (visible = v) }
}

describe("TrackingPoller", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("lee al arrancar y repite cada pollIntervalSeconds mientras está en vivo", async () => {
    const fetchTracking = vi.fn().mockResolvedValue(data())
    const { poller, onData, statuses } = setup(fetchTracking)
    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchTracking).toHaveBeenCalledTimes(1)
    expect(statuses).toEqual(["connecting", "live"])
    await vi.advanceTimersByTimeAsync(15_000)
    expect(fetchTracking).toHaveBeenCalledTimes(2)
    expect(onData).toHaveBeenCalledTimes(2)
    poller.stop()
  })

  it("deja de consultar cuando el envío ya no está en vivo", async () => {
    const fetchTracking = vi.fn().mockResolvedValue(data({ state: "closed" }))
    const { poller } = setup(fetchTracking)
    poller.start()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchTracking).toHaveBeenCalledTimes(1)
    poller.stop()
  })

  it("reintenta con backoff y se recupera", async () => {
    const fetchTracking = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(data())
    const { poller, statuses } = setup(fetchTracking)
    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(statuses.at(-1)).toBe("reconnecting")
    await vi.advanceTimersByTimeAsync(2_000)
    expect(fetchTracking).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(4_000)
    expect(fetchTracking).toHaveBeenCalledTimes(3)
    expect(statuses.at(-1)).toBe("live")
    poller.stop()
  })

  it("pausa con la pestaña oculta y retoma al volver", async () => {
    const fetchTracking = vi.fn().mockResolvedValue(data())
    const { poller, statuses, setVisible } = setup(fetchTracking)
    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    setVisible(false)
    poller.visibilityChanged()
    expect(statuses.at(-1)).toBe("paused")
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchTracking).toHaveBeenCalledTimes(1)
    setVisible(true)
    poller.visibilityChanged()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchTracking).toHaveBeenCalledTimes(2)
    poller.stop()
  })

  it("refresh() lee de inmediato", async () => {
    const fetchTracking = vi.fn().mockResolvedValue(data())
    const { poller } = setup(fetchTracking)
    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    poller.refresh()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchTracking).toHaveBeenCalledTimes(2)
    poller.stop()
  })
})
