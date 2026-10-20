import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth/api", () => ({ publicError: () => "error público" }))
import { ApiError } from "@movo/shared/src/errors/api-error"
import { actionFailure } from "./errors"

describe("actionFailure", () => {
  it("traduce los rechazos conocidos y conserva el código", () => {
    const result = actionFailure(new ApiError(409, "EMAIL_ALREADY_IN_USE", "x"))
    expect(result).toMatchObject({
      ok: false,
      code: "EMAIL_ALREADY_IN_USE",
      status: 409,
    })
    expect(result.ok === false && result.error).toMatch(/otra cuenta/)
    expect(result.ok === false && result.unconfirmed).toBeUndefined()
  })

  it("un servicio caído avisa que la acción pudo aplicarse", () => {
    const result = actionFailure(
      new ApiError(502, "PAYMENTS_SERVICE_UNAVAILABLE", "x")
    )
    expect(result).toMatchObject({ ok: false, unconfirmed: true, status: 502 })
    expect(result.ok === false && result.error).toMatch(/bitácora/)
  })

  it("lo desconocido cae al mensaje público", () => {
    expect(
      actionFailure(new ApiError(403, "AUTH_FORBIDDEN", "x"))
    ).toMatchObject({ ok: false, error: "error público" })
    expect(actionFailure(new Error("boom"))).toMatchObject({
      error: "error público",
    })
  })
})
