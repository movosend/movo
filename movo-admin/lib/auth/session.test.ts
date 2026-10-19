import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@movo/shared/src/errors/api-error"

vi.mock("server-only", () => ({}))
const mocks = vi.hoisted(() => ({
  gateway: vi.fn(),
  values: new Map<string, string>(),
  set: vi.fn(),
  requestHeaders: new Headers(),
}))
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = mocks.values.get(name)
      return value ? { value } : undefined
    },
    set: mocks.set,
  }),
  headers: async () => mocks.requestHeaders,
}))
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`)
  },
}))
vi.mock("./api", async (original) => ({
  ...(await original<object>()),
  gateway: mocks.gateway,
}))
import {
  assertOrigin,
  clearSession,
  readChallenge,
  renew,
  requireAdmin,
  seal,
  unseal,
  writeSession,
} from "./session"
import { ACCESS_COOKIE, CHALLENGE_COOKIE, REFRESH_COOKIE } from "./policy"
import {
  changeAccount,
  login,
  logout,
  resend,
  verify,
} from "@/app/login/actions"
const tokens = {
  accessToken: "private-access",
  refreshToken: "private-refresh",
  expiresIn: 900,
  sessionExpiresAt: new Date(Date.now() + 3600000).toISOString(),
}
const admin = {
  fullName: "Alena Ariza",
  roles: ["admin"],
  accountStatus: "active",
  emailVerified: true,
}
function form(values: Record<string, string>) {
  const data = new FormData()
  Object.entries(values).forEach(([k, v]) => data.set(k, v))
  return data
}
function challenge(resendAt = 0) {
  mocks.values.set(
    CHALLENGE_COOKIE,
    seal({
      challengeId: "private-challenge",
      email: "a***@movo.test",
      expiresAt: Date.now() + 600000,
      resendAt,
    })
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.gateway.mockReset()
  mocks.values.clear()
  process.env.MOVO_SESSION_SECRET = "test-only-server-secret-32-characters-long"
  process.env.MOVO_APP_ORIGIN = "https://admin.movo.test"
  mocks.requestHeaders = new Headers({ origin: process.env.MOVO_APP_ORIGIN })
  mocks.set.mockImplementation((name: string, value: string) => {
    if (value) mocks.values.set(name, value)
    else mocks.values.delete(name)
  })
})
describe("sesión del BFF", () => {
  it("cookies host-only, Secure, httpOnly y Lax con tope absoluto", async () => {
    await writeSession({
      ...tokens,
      sessionExpiresAt: new Date(Date.now() + 120000).toISOString(),
    })
    for (const [name, , options] of mocks.set.mock.calls) {
      expect(name).toMatch(/^__Host-/)
      expect(options).toMatchObject({
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
      })
      expect(options.domain).toBeUndefined()
      expect(options.maxAge).toBeLessThanOrEqual(120)
    }
    expect(mocks.values.has(CHALLENGE_COOKIE)).toBe(false)
  })
  it("no acepta una sesión que excedió su vencimiento", async () => {
    await expect(
      writeSession({
        ...tokens,
        sessionExpiresAt: new Date(Date.now() - 1).toISOString(),
      })
    ).rejects.toMatchObject({ statusCode: 401 })
    expect(mocks.set).not.toHaveBeenCalled()
  })
  it("cifra y autentica el desafío; un valor adulterado no se acepta", async () => {
    const value = seal({ challengeId: "private" })
    expect(value).not.toContain("private")
    expect(unseal(value)).toEqual({ challengeId: "private" })
    expect(unseal(`${value.slice(0, 10)}AAAA${value.slice(14)}`)).toBeNull()
    mocks.values.set(CHALLENGE_COOKIE, "invalid")
    expect(await readChallenge()).toBeNull()
  })
  it("desafíos vencidos no se usan", async () => {
    mocks.values.set(CHALLENGE_COOKIE, seal({ expiresAt: Date.now() - 1 }))
    expect(await readChallenge()).toBeNull()
  })
  it("el origen debe coincidir exactamente", async () => {
    await expect(assertOrigin()).resolves.toBeUndefined()
    mocks.requestHeaders = new Headers({ origin: "https://attacker.test" })
    await expect(assertOrigin()).rejects.toMatchObject({ statusCode: 403 })
  })
  it("sin access o con access inválido deriva al handler que puede escribir cookies", async () => {
    await expect(requireAdmin()).rejects.toThrow("redirect:/auth/refresh")
    mocks.values.set(ACCESS_COOKIE, "invalid")
    mocks.gateway.mockRejectedValue(
      new ApiError(401, "AUTH_TOKEN_INVALID", "invalid")
    )
    await expect(requireAdmin()).rejects.toThrow("redirect:/auth/refresh")
    expect(mocks.set).not.toHaveBeenCalled()
  })
  it("valida perfil y permiso de panel, sin devolver tokens", async () => {
    mocks.values.set(ACCESS_COOKIE, tokens.accessToken)
    mocks.gateway
      .mockResolvedValueOnce(admin)
      .mockResolvedValueOnce({ authenticated: true })
    const profile = await requireAdmin()
    expect(profile).toEqual(admin)
    expect(JSON.stringify(profile)).not.toContain(tokens.accessToken)
    expect(mocks.gateway).toHaveBeenCalledWith("/admin/session", {
      accessToken: tokens.accessToken,
    })
  })
  it("renueva y reintenta una sola vez desde acciones", async () => {
    mocks.values.set(ACCESS_COOKIE, "expired")
    mocks.values.set(REFRESH_COOKIE, tokens.refreshToken)
    // Profile and panel checks run in parallel, so answer by path, not by call order.
    mocks.gateway.mockImplementation(
      async (path: string, options?: { accessToken?: string }) => {
        if (path === "/auth/admin/refresh") return tokens
        if (options?.accessToken === "expired")
          throw new ApiError(401, "AUTH_TOKEN_EXPIRED", "expired")
        return path === "/users/me" ? admin : { authenticated: true }
      }
    )
    expect(await requireAdmin(true)).toEqual(admin)
    expect(
      mocks.gateway.mock.calls.filter(
        ([path]) => path === "/auth/admin/refresh"
      )
    ).toHaveLength(1)
  })
  it("refresh rechazado borra cookies y redirige con aviso de sesión vencida", async () => {
    mocks.values.set(REFRESH_COOKIE, tokens.refreshToken)
    mocks.gateway.mockRejectedValue(
      new ApiError(401, "AUTH_REFRESH_INVALID", "invalid")
    )
    await expect(requireAdmin(true)).rejects.toThrow(
      "redirect:/login?expired=1"
    )
    expect(mocks.values.size).toBe(0)
  })
  it("infraestructura caída conserva cookies y permite reintentar", async () => {
    mocks.values.set(ACCESS_COOKIE, tokens.accessToken)
    mocks.gateway.mockRejectedValue(new ApiError(503, "INTERNAL_ERROR", "down"))
    await expect(requireAdmin(true)).rejects.toMatchObject({ statusCode: 503 })
    expect(mocks.set).not.toHaveBeenCalled()
  })
  it("dos refresh del mismo token derivan la misma clave sin exponerlo", async () => {
    mocks.values.set(REFRESH_COOKIE, tokens.refreshToken)
    mocks.gateway.mockResolvedValue(tokens)
    await renew()
    await renew()
    const first = mocks.gateway.mock.calls[0][1].idempotencyKey
    expect(first).toBe(mocks.gateway.mock.calls[1][1].idempotencyKey)
    expect(first).not.toContain(tokens.refreshToken)
  })
  it("limpia todas las cookies con sus atributos de seguridad", async () => {
    await clearSession()
    expect(mocks.set).toHaveBeenCalledTimes(3)
    for (const [, value, options] of mocks.set.mock.calls) {
      expect(value).toBe("")
      expect(options).toMatchObject({ maxAge: 0, secure: true })
    }
  })
})
describe("acciones de autenticación", () => {
  it("valida el formulario antes de llamar al gateway", async () => {
    expect(
      (await login({}, form({ identifier: "invalid", password: "" }))).error
    ).toBeDefined()
    expect(mocks.gateway).not.toHaveBeenCalled()
  })
  it("login conserva solo un desafío cifrado y redirige a OTP", async () => {
    mocks.gateway.mockResolvedValue({
      challengeId: "private-challenge",
      cooldownSeconds: 60,
      maskedEmail: "a***@movo.test",
    })
    await expect(
      login(
        {},
        form({ identifier: "Alena@movo.test", password: "secret-password" })
      )
    ).rejects.toThrow("redirect:/verify")
    expect(mocks.gateway).toHaveBeenCalledWith("/auth/admin/login", {
      body: { email: "alena@movo.test", password: "secret-password" },
    })
    expect(await readChallenge()).toMatchObject({
      challengeId: "private-challenge",
      email: "a***@movo.test",
    })
    expect(JSON.stringify(mocks.set.mock.calls)).not.toContain(
      "secret-password"
    )
    expect(JSON.stringify(mocks.set.mock.calls)).not.toContain(
      "private-challenge"
    )
  })
  it("login por teléfono manda solo los dígitos como phone", async () => {
    mocks.gateway.mockResolvedValue({
      challengeId: "c",
      cooldownSeconds: 60,
      maskedEmail: "a***@movo.test",
    })
    await expect(
      login(
        {},
        form({
          method: "phone",
          identifier: "+54 9 351 123-4567",
          password: "secret",
        })
      )
    ).rejects.toThrow("redirect:/verify")
    expect(mocks.gateway).toHaveBeenCalledWith("/auth/admin/login", {
      body: { phone: "5493511234567", password: "secret" },
    })
  })
  it("errores genéricos no devuelven secretos ni el error interno", async () => {
    mocks.gateway.mockRejectedValue(
      new ApiError(401, "AUTH_INVALID_CREDENTIALS", "sensitive backend message")
    )
    const result = await login(
      {},
      form({ identifier: "test@movo.test", password: "secret" })
    )
    expect(result).toEqual({
      error: "No pudimos verificar los datos. Revisalos y volvé a intentar.",
    })
  })
  it("OTP exige seis dígitos y escribe tokens solamente en cookies", async () => {
    challenge()
    expect((await verify({}, form({ code: "123" }))).error).toBeDefined()
    expect(mocks.gateway).not.toHaveBeenCalled()
    mocks.gateway.mockResolvedValue(tokens)
    await expect(verify({}, form({ code: "123456" }))).rejects.toThrow(
      "redirect:/"
    )
    expect(mocks.values.get(ACCESS_COOKIE)).toBe(tokens.accessToken)
    expect(await readChallenge()).toBeNull()
  })
  it("el reenvío respeta el cooldown del servidor", async () => {
    challenge(Date.now() + 60000)
    expect((await resend({})).error).toBeDefined()
    expect(mocks.gateway).not.toHaveBeenCalled()
    challenge()
    mocks.gateway.mockResolvedValue({ cooldownSeconds: 45 })
    const before = Date.now()
    const result = await resend({})
    expect(result.resendAt).toBeGreaterThanOrEqual(before + 45000)
    expect(result).not.toHaveProperty("challengeId")
  })
  it("cambiar de cuenta elimina el desafío", async () => {
    challenge()
    await expect(changeAccount()).rejects.toThrow("redirect:/login")
    expect(await readChallenge()).toBeNull()
  })
  it("logout revoca en backend antes de limpiar cookies", async () => {
    mocks.values.set(ACCESS_COOKIE, tokens.accessToken)
    mocks.values.set(REFRESH_COOKIE, tokens.refreshToken)
    mocks.gateway
      .mockResolvedValueOnce(admin)
      .mockResolvedValueOnce({ authenticated: true })
      .mockResolvedValueOnce(undefined)
    await expect(logout({})).rejects.toThrow("redirect:/login")
    expect(mocks.gateway).toHaveBeenCalledWith(
      "/auth/admin/logout",
      expect.objectContaining({ body: { refreshToken: tokens.refreshToken } })
    )
    expect(mocks.values.size).toBe(0)
  })
})
