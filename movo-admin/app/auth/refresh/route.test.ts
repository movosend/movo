import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { ApiError } from "@movo/shared/src/errors/api-error"
const mocks = vi.hoisted(() => ({
  renew: vi.fn(),
  validateAdmin: vi.fn(),
  clearSession: vi.fn(),
}))
vi.mock("@/lib/auth/session", () => mocks)
import { GET } from "./route"
beforeEach(() => {
  vi.clearAllMocks()
  mocks.renew.mockReset().mockResolvedValue("private")
  mocks.validateAdmin.mockReset().mockResolvedValue({})
  process.env.MOVO_APP_ORIGIN = "https://admin.test"
})
describe("handler de renovación", () => {
  it("renueva una vez y limita el retorno a rutas internas", async () => {
    const response = await GET(
      new NextRequest(
        "https://admin.test/auth/refresh?returnTo=https://attacker.test"
      )
    )
    expect(response.headers.get("location")).toBe("https://admin.test/")
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(mocks.renew).toHaveBeenCalledTimes(1)
    expect(mocks.validateAdmin).toHaveBeenCalledWith("private")
  })
  it("rechaza otro origen, incluso subdominios del mismo sitio", async () => {
    for (const site of ["cross-site", "same-site"]) {
      expect(
        (
          await GET(
            new NextRequest("https://admin.test/auth/refresh", {
              headers: { "sec-fetch-site": site },
            })
          )
        ).status
      ).toBe(403)
    }
    expect(mocks.renew).not.toHaveBeenCalled()
  })
  it("rechazo de refresh borra sesión y explica el vencimiento", async () => {
    mocks.renew.mockRejectedValue(
      new ApiError(401, "AUTH_REFRESH_INVALID", "invalid")
    )
    const response = await GET(
      new NextRequest("https://admin.test/auth/refresh")
    )
    expect(response.headers.get("location")).toBe(
      "https://admin.test/login?expired=1"
    )
    expect(mocks.clearSession).toHaveBeenCalledOnce()
  })
  it("infraestructura caída conserva la sesión y ofrece reintento", async () => {
    mocks.renew.mockRejectedValue(new ApiError(503, "INTERNAL_ERROR", "down"))
    const response = await GET(
      new NextRequest("https://admin.test/auth/refresh")
    )
    expect(response.headers.get("location")).toBe(
      "https://admin.test/login?unavailable=1"
    )
    expect(mocks.clearSession).not.toHaveBeenCalled()
  })
})
