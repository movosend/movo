import { describe, expect, it } from "vitest"
import { describeBalance, parseAmountArs } from "./money"

describe("parseAmountArs", () => {
  it.each([
    ["1500", 1500],
    ["1.500", 1500],
    ["1.240,50", 1240.5],
    ["1,240.50", 1240.5],
    ["1240,5", 1240.5],
    ["1240.50", 1240.5],
    ["$ 300", 300],
    ["12.50", 12.5],
    ["1.234.567", 1234567],
  ])("lee %s como %d", (raw, expected) => {
    expect(parseAmountArs(raw)).toBe(expected)
  })

  it.each(["", "0", "0,00", "-5", "abc", "1,234", "10,555", "1..5", "$"])(
    "rechaza %j",
    (raw) => {
      expect(parseAmountArs(raw)).toBeNull()
    }
  )
})

describe("describeBalance", () => {
  const f = (n: number) => `$${Math.abs(n)}`
  it("lee el signo como la cuenta corriente", () => {
    expect(describeBalance(300, f)).toBe("Debe $300")
    expect(describeBalance(-120, f)).toBe("A favor $120")
    expect(describeBalance(0, f)).toBe("Al día")
  })
})
