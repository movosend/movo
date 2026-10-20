import { afterEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({
  gateway: vi.fn<(...args: unknown[]) => Promise<unknown>>(
    async () => undefined
  ),
  requireAdmin: vi.fn(async () => ({
    id: "11111111-1111-1111-1111-111111111111",
    email: "ada@movo.test",
  })),
  grant: null as unknown,
  writeGrant: vi.fn(async () => undefined),
  clearGrant: vi.fn(async () => undefined),
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
  readGrant: async () => mocks.grant,
  writeGrant: mocks.writeGrant,
  clearGrant: mocks.clearGrant,
}))
import { ApiError } from "@movo/shared/src/errors/api-error"
import {
  confirmGrant,
  revokeAdmin,
  searchCandidates,
  startGrant,
} from "./actions"

const OTHER = "22222222-2222-2222-2222-222222222222"
const form = (values: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}

const ME = "11111111-1111-1111-1111-111111111111"
const flow = (overrides: Record<string, unknown> = {}) => ({
  adminId: ME,
  challengeId: "challenge-1",
  targetEmail: "ana@movo.test",
  targetName: "Ana Paz",
  maskedEmail: "a***@movo.test",
  expiresAt: Date.now() + 60_000,
  resendAt: 0,
  ...overrides,
})

afterEach(() => {
  vi.clearAllMocks()
  mocks.grant = null
})

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

  it("paso 1: valida la contraseña del admin contra el login del panel y sella el desafío", async () => {
    mocks.gateway.mockResolvedValueOnce({
      challengeId: "challenge-1",
      cooldownSeconds: 30,
      maskedEmail: "a***@movo.test",
    })
    const result = await startGrant(
      {},
      form({
        targetEmail: " Ana@Movo.TEST ",
        targetName: "Ana Paz",
        password: "secreta",
      })
    )
    expect(result.codeSentTo).toBe("a***@movo.test")
    expect(mocks.gateway).toHaveBeenCalledWith("/auth/admin/login", {
      body: { email: "ada@movo.test", password: "secreta" },
    })
    expect(mocks.writeGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: ME,
        targetEmail: "ana@movo.test",
        challengeId: "challenge-1",
      })
    )
  })

  it("paso 1: una contraseña incorrecta no avanza ni sella nada", async () => {
    mocks.gateway.mockRejectedValueOnce(
      new ApiError(401, "AUTH_INVALID_CREDENTIALS", "no")
    )
    const result = await startGrant(
      {},
      form({ targetEmail: "ana@movo.test", password: "mala" })
    )
    expect(result.error).toMatch(/contraseña no es correcta/)
    expect(result.codeSentTo).toBeUndefined()
    expect(mocks.writeGrant).not.toHaveBeenCalled()
  })

  it("paso 1: sin una persona elegida de la lista no llega al gateway", async () => {
    const result = await startGrant(
      {},
      form({ targetEmail: "nada", password: "secreta" })
    )
    expect(result.restart).toBe(true)
    expect(mocks.gateway).not.toHaveBeenCalled()
  })

  it("paso 2: con el código correcto cierra la sesión de prueba y otorga a quien sellaron en el paso 1", async () => {
    mocks.grant = flow()
    mocks.gateway
      .mockResolvedValueOnce({
        accessToken: "proof-a",
        refreshToken: "proof-r",
      })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({})
    const result = await confirmGrant(
      {},
      // El destino del formulario se ignora: sale de la cookie sellada.
      form({ code: "123456", targetEmail: "otro@movo.test" })
    )
    expect(result.done).toBe("Ana Paz")
    expect(mocks.gateway).toHaveBeenNthCalledWith(1, "/auth/admin/verify", {
      body: { challengeId: "challenge-1", code: "123456" },
    })
    expect(mocks.gateway).toHaveBeenNthCalledWith(2, "/auth/admin/logout", {
      accessToken: "proof-a",
      body: { refreshToken: "proof-r" },
    })
    expect(mocks.gateway).toHaveBeenNthCalledWith(3, "/admin/admins", {
      accessToken: "access-token",
      body: { email: "ana@movo.test" },
    })
    expect(mocks.clearGrant).toHaveBeenCalled()
  })

  it("paso 2: un código incorrecto no otorga nada y deja reintentar", async () => {
    mocks.grant = flow()
    mocks.gateway.mockRejectedValueOnce(
      new ApiError(400, "AUTH_OTP_INVALID", "no")
    )
    const result = await confirmGrant({}, form({ code: "000000" }))
    expect(result.error).toBe("error público")
    expect(result.restart).toBeUndefined()
    expect(mocks.gateway).toHaveBeenCalledTimes(1)
    expect(mocks.clearGrant).not.toHaveBeenCalled()
  })

  it("paso 2: sin desafío, vencido o de otro admin hay que empezar de nuevo", async () => {
    expect((await confirmGrant({}, form({ code: "123456" }))).restart).toBe(
      true
    )
    mocks.grant = flow({ adminId: "99999999-9999-9999-9999-999999999999" })
    expect((await confirmGrant({}, form({ code: "123456" }))).restart).toBe(
      true
    )
    expect(mocks.gateway).not.toHaveBeenCalled()
  })

  it("el autocompletado exige 2 letras y devuelve los candidatos del gateway", async () => {
    expect(await searchCandidates("a")).toEqual([])
    expect(mocks.gateway).not.toHaveBeenCalled()
    mocks.gateway.mockResolvedValueOnce([{ id: "x" }])
    expect(await searchCandidates("an")).toEqual([{ id: "x" }])
    expect(mocks.gateway).toHaveBeenCalledWith(
      "/admin/admins/candidates?q=an",
      { accessToken: "access-token" }
    )
  })

  it("con el backend caído al validar la sesión devuelve el error en vez de romper la pantalla", async () => {
    mocks.requireAdmin.mockRejectedValueOnce(
      new ApiError(503, "INTERNAL_ERROR", "caído")
    )
    const result = await startGrant(
      {},
      form({ targetEmail: "ana@movo.test", password: "secreta" })
    )
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
