import { describe, expect, it } from "vitest"
import {
  accountPill,
  ageFrom,
  daysUntil,
  formatArs,
  formatDate,
  formatDni,
  formatPhone,
  formatSignedArs,
} from "./format"

describe("formato", () => {
  it("fechas en es-AR sin puntos", () => {
    expect(formatDate("2026-10-19T15:00:00.000Z")).toBe("19 oct 2026")
    expect(formatDate("1988-04-18")).toBe("18 abr 1988")
    expect(formatDate(null)).toBe("—")
  })

  it("edad y días restantes", () => {
    const now = new Date("2026-10-19T12:00:00-03:00")
    expect(ageFrom("1988-04-18", now)).toBe(38)
    expect(daysUntil("2026-11-02", now)).toBe(14)
    expect(daysUntil("2026-10-01", now)).toBe(0)
  })

  it("montos con signo", () => {
    expect(formatArs(-1500)).toBe("$1.500")
    expect(formatSignedArs(1240)).toBe("+$1.240")
    expect(formatSignedArs(-300)).toBe("−$300")
  })

  it("teléfono y DNI", () => {
    expect(formatPhone("+5493516124410")).toBe("+54 9 351 612-4410")
    expect(formatPhone("+34600111222")).toBe("+34600111222")
    expect(formatDni("33812405")).toBe("33.812.405")
    expect(formatDni(null)).toBe("—")
  })

  it("estado de la cuenta: suspendida lleva fecha, indefinida e inhabilitada no", () => {
    expect(accountPill("active", null).tone).toBe("success")
    expect(accountPill("deleted", null).label).toBe("Eliminada")
    expect(accountPill("banned", "2026-11-02T12:00:00Z", true).label).toBe(
      "Suspendida · hasta 2 nov"
    )
    expect(accountPill("suspended", "2026-11-02T12:00:00Z").label).toBe(
      "Suspendida hasta el 2 nov"
    )
    expect(accountPill("suspended", null)).toEqual({
      label: "Suspendida",
      tone: "warning",
    })
    expect(accountPill("banned", null)).toEqual({
      label: "Inhabilitada",
      tone: "danger",
    })
  })
})
