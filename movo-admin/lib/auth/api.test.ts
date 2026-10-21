import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@movo/shared/src/errors/api-error"
vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-request-id": "request-from-browser" }),
}))
import { gateway, publicError } from "./api"
const fetchMock = vi.fn()
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock)
  fetchMock.mockReset()
  process.env.MOVO_GATEWAY_URL = "https://api.test"
})
describe("cliente del gateway", () => {
  it("propaga request id y credenciales solamente en headers server-to-server", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ authenticated: true }))
    )
    expect(await gateway("/admin/session", { accessToken: "private" })).toEqual(
      { authenticated: true }
    )
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.test/api/v1/admin/session",
      expect.objectContaining({
        cache: "no-store",
        redirect: "error",
        headers: expect.objectContaining({
          "x-request-id": "request-from-browser",
          Authorization: "Bearer private",
        }),
      })
    )
  })
  it("soporta PATCH con cuerpo JSON (bandeja de soporte)", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true })))
    await gateway("/admin/support/conversations/1", {
      method: "PATCH",
      body: { priority: "high" },
      accessToken: "private",
    })
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.test/api/v1/admin/support/conversations/1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ priority: "high" }),
      })
    )
  })
  it("normaliza ApiError sin reenviar mensajes sensibles", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: "AUTH_INVALID_CREDENTIALS", message: "sensitive" },
        }),
        { status: 401 }
      )
    )
    await expect(
      gateway("/auth/admin/login", {
        body: { email: "a@movo.test", password: "private" },
      })
    ).rejects.toMatchObject({
      statusCode: 401,
      code: "AUTH_INVALID_CREDENTIALS",
      message: "La solicitud no pudo completarse.",
    })
  })
  it("un fallo de conexión es recuperable", async () => {
    fetchMock.mockRejectedValue(new Error("internal host details"))
    await expect(gateway("/admin/session")).rejects.toMatchObject({
      statusCode: 503,
      code: "INTERNAL_ERROR",
    })
  })
  it("tiene mensaje propio para conflicto de interés", () => {
    expect(
      publicError(new ApiError(403, "ADMIN_CONFLICT_OF_INTEREST", "internal"))
    ).toBe("No podés modificar un registro en el que sos parte.")
  })
})
