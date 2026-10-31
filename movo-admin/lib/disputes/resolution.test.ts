import { describe, expect, it } from "vitest"
import type { AdminDisputeResolutionPreview } from "@movo/shared/src/types/admin-disputes"
import { canConfirm, computeSplit } from "./resolution"

const preview = (
  over: Partial<AdminDisputeResolutionPreview> = {}
): AdminDisputeResolutionPreview => ({
  statusAtOpen: "in_transit",
  stakeArs: 10000,
  minimumPartialArs: 2000,
  outcomes: [],
  presets: [],
  ...over,
})

describe("computeSplit", () => {
  it("a favor del transportista: se queda todo", () => {
    expect(
      computeSplit(
        preview(),
        "carrier",
        { kind: "preset", percentage: 50 },
        "Hernán"
      )
    ).toEqual({ carrierAmountArs: 10000, senderAmountArs: 0, error: null })
  })

  it("a favor del emisor: vuelve todo", () => {
    expect(
      computeSplit(
        preview(),
        "sender",
        { kind: "preset", percentage: 50 },
        "Hernán"
      )
    ).toEqual({ carrierAmountArs: 0, senderAmountArs: 10000, error: null })
  })

  it("parcial por porcentaje predefinido", () => {
    const split = computeSplit(
      preview(),
      "partial",
      { kind: "preset", percentage: 25 },
      "Hernán"
    )
    expect(split).toEqual({
      carrierAmountArs: 2500,
      senderAmountArs: 7500,
      error: null,
    })
  })

  it("un porcentaje fuera del set no es válido", () => {
    const split = computeSplit(
      preview(),
      "partial",
      { kind: "preset", percentage: 33 },
      "Hernán"
    )
    expect(split.error).toMatch(/predefinidos/)
  })

  it("monto libre: pide el monto, rechaza cero y el total", () => {
    const of = (raw: string) =>
      computeSplit(preview(), "partial", { kind: "amount", raw }, "Hernán")
    expect(of("").error).toBe("Ingresá cuánto conserva Hernán.")
    expect(of("0").error).toBe("El monto tiene que ser mayor que cero.")
    expect(of("10000").error).toMatch(/A favor del transportista/)
    expect(of("5000")).toMatchObject({
      carrierAmountArs: 5000,
      senderAmountArs: 5000,
      error: null,
    })
  })

  it("por debajo del mínimo de la captura parcial muestra el mínimo", () => {
    const split = computeSplit(
      preview(),
      "partial",
      { kind: "amount", raw: "1500" },
      "Hernán"
    )
    expect(split.error).toMatch(/El mínimo es \$2\.000/)
  })

  it("sin mínimo (reembolso) no restringe", () => {
    const split = computeSplit(
      preview({ statusAtOpen: "completed", minimumPartialArs: null }),
      "partial",
      { kind: "amount", raw: "100" },
      "Hernán"
    )
    expect(split.error).toBeNull()
  })
})

describe("canConfirm", () => {
  const ok = { carrierAmountArs: 1, senderAmountArs: 1, error: null }
  it("exige razonamiento, tilde y un reparto válido", () => {
    expect(canConfirm(ok, "", true, 10)).toBe(false)
    expect(canConfirm(ok, "corto", true, 10)).toBe(false)
    expect(canConfirm(ok, "un razonamiento largo", false, 10)).toBe(false)
    expect(
      canConfirm({ ...ok, error: "x" }, "un razonamiento largo", true, 10)
    ).toBe(false)
    expect(canConfirm(ok, "  un razonamiento largo  ", true, 10)).toBe(true)
  })
})
