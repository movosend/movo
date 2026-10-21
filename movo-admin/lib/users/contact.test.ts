import { describe, expect, it } from "vitest"
import { normalizeArPhone, normalizeEmail } from "./contact"

describe("normalizeArPhone", () => {
  it.each([
    "351 612-4410",
    "0351 612 4410",
    "+54 9 351 612-4410",
    "54 351 6124410",
    "(351) 612-4410",
    "+5493516124410",
  ])("lleva %s a E.164 móvil", (raw) => {
    expect(normalizeArPhone(raw)).toBe("+5493516124410")
  })

  it.each([
    "",
    "612-4410",
    "abc",
    "351 612 44",
    "+1 305 555 0100",
    "0000000000",
  ])("rechaza %s", (raw) => {
    expect(normalizeArPhone(raw)).toBeNull()
  })
})

describe("normalizeEmail", () => {
  it("pasa a minúsculas y recorta", () => {
    expect(normalizeEmail("  Marcos.VERA@Gmail.com ")).toBe(
      "marcos.vera@gmail.com"
    )
  })

  it.each(["", "sin-arroba", "a@b", "a b@c.com"])("rechaza %j", (raw) => {
    expect(normalizeEmail(raw)).toBeNull()
  })
})
