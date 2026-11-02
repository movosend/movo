import { describe, expect, it } from "vitest"
import type { OverviewInbox } from "@movo/shared/src/types/admin-reports"
import {
  INBOXES,
  inboxChips,
  overviewSummary,
  type OverviewBlocks,
} from "./overview"

const now = new Date("2026-11-01T12:00:00Z")
const inbox = (
  count: number,
  oldestAt: string | null,
  extra: object = {}
): OverviewInbox =>
  ({
    count,
    oldestAt,
    slaHours: 24,
    overSla: false,
    yesterdayCount: null,
    breakdown: [],
    ...extra,
  }) as OverviewInbox

describe("bandejas de Inicio", () => {
  it("muestra dos motivos y junta el resto en Otros", () => {
    const disputes = INBOXES.find((d) => d.id === "disputes")!
    expect(
      inboxChips(disputes, [
        { key: "damaged", count: 3 },
        { key: "not_delivered", count: 2 },
        { key: "other", count: 1 },
        { key: "transit_anomaly", count: 1 },
      ])
    ).toEqual([
      { label: "Daño", count: 3 },
      { label: "No entregado", count: 2 },
      { label: "Otros", count: 2 },
    ])
  })

  it("el resumen suma lo cargado, nombra lo más viejo y cuenta las que fallaron", () => {
    const blocks = {
      disputes: {
        data: { ...inbox(7, "2026-10-29T12:00:00Z"), awaitingPayment: 2 },
        error: null,
      },
      kyc: {
        data: {
          ...inbox(18, "2026-10-31T10:00:00Z"),
          carriers: 11,
          senders: 7,
        },
        error: null,
      },
      userReports: {
        data: null,
        error: { code: "UPSTREAM_TIMEOUT", message: "svc-users tardó." },
      },
    } as OverviewBlocks
    expect(overviewSummary(blocks, new Set(), now)).toBe(
      "Hay 25 cosas para atender en 2 bandejas. La más vieja: una disputa de hace 3 d. 6 bandejas no cargaron."
    )
  })

  it("mientras todo carga, lo dice", () => {
    expect(overviewSummary({}, new Set(INBOXES.map((d) => d.id)), now)).toBe(
      "Cargando las bandejas…"
    )
  })
})
