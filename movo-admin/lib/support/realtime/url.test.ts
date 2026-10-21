import { describe, expect, it } from "vitest"
import { isTrustedSupportSocketUrl } from "./url"

describe("isTrustedSupportSocketUrl", () => {
  const gateway = "https://api-dev.movosend.app"

  it("acepta wss en el gateway configurado", () => {
    expect(
      isTrustedSupportSocketUrl(
        "wss://api-dev.movosend.app/api/v1/admin/support/ws",
        gateway,
        false
      )
    ).toBe(true)
  })

  it.each([
    "ws://api-dev.movosend.app/support",
    "https://api-dev.movosend.app/support",
    "wss://evil.example/support",
    "wss://api-dev.movosend.app.evil.example/support",
    "wss://user:pass@api-dev.movosend.app/support",
    "not a url",
  ])("rechaza el destino %s", (url) => {
    expect(isTrustedSupportSocketUrl(url, gateway, false)).toBe(false)
  })

  it("permite ws local solo en desarrollo", () => {
    const local = "ws://localhost:3000/support"
    expect(
      isTrustedSupportSocketUrl(local, "http://localhost:3000", true)
    ).toBe(true)
    expect(
      isTrustedSupportSocketUrl(local, "http://localhost:3000", false)
    ).toBe(false)
    expect(
      isTrustedSupportSocketUrl(local, "http://localhost:3001", true)
    ).toBe(false)
  })
})
