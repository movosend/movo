import { afterEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({
  gateway: vi.fn(async () => undefined),
  requireAdmin: vi.fn(async () => ({
    id: "11111111-1111-1111-1111-111111111111",
  })),
}))
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "access-token" }) }),
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/auth/api", () => ({
  gateway: mocks.gateway,
  publicError: () => "error público",
}))
vi.mock("@/lib/auth/session", () => ({
  assertOrigin: async () => {},
  requireAdmin: mocks.requireAdmin,
}))
import { ApiError } from "@movo/shared/src/errors/api-error"
import { grantAdmin, revokeAdmin } from "./actions"

const OTHER = "22222222-2222-2222-2222-222222222222"
const form = (values: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}

afterEach(() => vi.clearAllMocks())

describe("acciones de admins", () => {
  it("revocarse a uno mismo se corta antes de llamar al gateway", async () => {
    const result = await revokeAdmin(
      {},
      form({ userId: "11111111-1111-1111-1111-111111111111", reason: "Prueba" })
    )
    expect(result.error).toMatch(/vos mismo/)
    expect(mocks.gateway).not.toHaveBeenCalled()
  })

  it("revocar exige motivo", async () => {
    const result = await revokeAdmin({}, form({ userId: OTHER, reason: " " }))
    expect(result.error).toMatch(/motivo/)
    expect(mocks.gateway).not.toHaveBeenCalled()
  })

  it("revoca con DELETE, motivo y token de acceso", async () => {
    const result = await revokeAdmin(
      {},
      form({ userId: OTHER, reason: "Dejó el equipo" })
    )
    expect(result).toEqual({})
    expect(mocks.gateway).toHaveBeenCalledWith(`/admin/admins/${OTHER}`, {
      method: "DELETE",
      accessToken: "access-token",
      body: { reason: "Dejó el equipo" },
    })
  })

  it("otorga normalizando el email", async () => {
    const result = await grantAdmin({}, form({ email: "  Ana@Movo.TEST " }))
    expect(result.notice).toMatch(/ana@movo.test/)
    expect(mocks.gateway).toHaveBeenCalledWith("/admin/admins", {
      accessToken: "access-token",
      body: { email: "ana@movo.test" },
    })
  })

  it("un email inválido no llega al gateway", async () => {
    expect((await grantAdmin({}, form({ email: "nada" }))).error).toBeDefined()
    expect(mocks.gateway).not.toHaveBeenCalled()
  })

  it("con el backend caído al validar la sesión devuelve el error en vez de romper la pantalla", async () => {
    mocks.requireAdmin.mockRejectedValueOnce(
      new ApiError(503, "INTERNAL_ERROR", "caído")
    )
    const result = await grantAdmin({}, form({ email: "ana@movo.test" }))
    expect(result.error).toBe("error público")
    expect(mocks.gateway).not.toHaveBeenCalled()
  })

  it("devuelve el error público si el gateway rechaza", async () => {
    mocks.gateway.mockRejectedValueOnce(new Error("boom"))
    expect(
      (await revokeAdmin({}, form({ userId: OTHER, reason: "Motivo" }))).error
    ).toBe("error público")
  })
})
