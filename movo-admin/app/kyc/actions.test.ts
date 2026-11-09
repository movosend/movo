import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(async () => ({
    id: "11111111-1111-1111-1111-111111111111",
    fullName: "Ada Admin",
  })),
  revalidatePath: vi.fn(),
  decideKycReview: vi.fn(),
}))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("@/lib/auth/api", () => ({ publicError: () => "error público" }))
vi.mock("@/lib/auth/session", () => ({
  assertOrigin: async () => {},
  requireAdmin: mocks.requireAdmin,
}))
vi.mock("@/lib/kyc/api", () => ({ decideKycReview: mocks.decideKycReview }))

import { ApiError } from "@movo/shared/src/errors/api-error"
import { decideKyc } from "./actions"

const SESSION = "6b2c1d0e-4f3a-4b5c-8d9e-0a1b2c3d4e5f"
const REASON = "El documento y la selfie coinciden"
const DONE = {
  sessionId: SESSION,
  userId: "22222222-2222-2222-2222-222222222222",
  verificationType: "identity",
  status: "approved",
}

afterEach(() => vi.clearAllMocks())

describe("decideKyc", () => {
  it("decide con el motivo sin espacios y refresca la cola y el caso", async () => {
    mocks.decideKycReview.mockResolvedValue(DONE)

    const result = await decideKyc(SESSION, "approved", `  ${REASON}  `)

    expect(result).toEqual({ ok: true, data: DONE })
    expect(mocks.decideKycReview).toHaveBeenCalledWith(SESSION, {
      decision: "approved",
      reason: REASON,
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/kyc")
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/kyc/${SESSION}`)
  })

  it.each([
    ["id con caracteres raros", "../x", "approved", REASON],
    ["decisión inválida", SESSION, "maybe", REASON],
    ["motivo corto", SESSION, "approved", "corto"],
    ["motivo en blanco", SESSION, "rejected", "            "],
    ["motivo larguísimo", SESSION, "rejected", "x".repeat(501)],
  ])("rechaza %s con 400 y no llama al backend", async (_n, id, decision, reason) => {
    const result = await decideKyc(
      id,
      decision as "approved" | "rejected",
      reason
    )

    expect(result).toMatchObject({ ok: false, status: 400 })
    expect(mocks.decideKycReview).not.toHaveBeenCalled()
  })

  it("sin sesión de admin devuelve el error y no decide", async () => {
    mocks.requireAdmin.mockRejectedValueOnce(
      new ApiError(403, "AUTH_FORBIDDEN", "no")
    )

    const result = await decideKyc(SESSION, "approved", REASON)

    expect(result).toMatchObject({ ok: false, status: 403 })
    expect(mocks.decideKycReview).not.toHaveBeenCalled()
  })

  it("un 409 explica que el caso ya no está en revisión y no refresca", async () => {
    mocks.decideKycReview.mockRejectedValue(
      new ApiError(409, "KYC_REVIEW_STATUS_CHANGED", "x")
    )

    const result = await decideKyc(SESSION, "approved", REASON)

    expect(result).toMatchObject({
      ok: false,
      status: 409,
      code: "KYC_REVIEW_STATUS_CHANGED",
    })
    expect(result.ok === false && result.error).toMatch(/ya no está en revisión/)
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("un conflicto de interés explica que decide otro admin", async () => {
    mocks.decideKycReview.mockRejectedValue(
      new ApiError(403, "ADMIN_CONFLICT_OF_INTEREST", "x")
    )

    const result = await decideKyc(SESSION, "approved", REASON)

    expect(result.ok === false && result.error).toMatch(/tu propia verificación/)
  })

  it("si Didit rechaza el pedido (502) es un rechazo seguro: reintentable, sin 'sin confirmar' ni refresco", async () => {
    mocks.decideKycReview.mockRejectedValue(
      new ApiError(502, "KYC_PROVIDER_ERROR", "x")
    )

    const result = await decideKyc(SESSION, "rejected", REASON)

    expect(result).toMatchObject({ ok: false, code: "KYC_PROVIDER_ERROR" })
    expect(result.ok === false && result.unconfirmed).toBeUndefined()
    expect(result.ok === false && result.error).toMatch(/no se cambió nada/)
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("si el servicio no responde (5xx) queda sin confirmar y refresca por si se aplicó", async () => {
    mocks.decideKycReview.mockRejectedValue(
      new ApiError(502, "USERS_SERVICE_UNAVAILABLE", "x")
    )

    const result = await decideKyc(SESSION, "approved", REASON)

    expect(result).toMatchObject({ ok: false, unconfirmed: true })
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/kyc")
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/kyc/${SESSION}`)
  })
})
