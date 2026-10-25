import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(async () => ({
    id: "11111111-1111-1111-1111-111111111111",
    fullName: "Ada Admin",
  })),
  revalidatePath: vi.fn(),
  getStatusOptions: vi.fn(),
  requestStepUp: vi.fn(),
  verifyStepUp: vi.fn(),
  changeStatus: vi.fn(),
}))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("@/lib/auth/api", () => ({ publicError: () => "error público" }))
vi.mock("@/lib/auth/session", () => ({
  assertOrigin: async () => {},
  requireAdmin: mocks.requireAdmin,
}))
vi.mock("@/lib/shipments/status-change", () => ({
  getStatusOptions: mocks.getStatusOptions,
  requestStepUp: mocks.requestStepUp,
  verifyStepUp: mocks.verifyStepUp,
  changeStatus: mocks.changeStatus,
}))

import { ApiError } from "@movo/shared/src/errors/api-error"
import {
  loadStatusOptions,
  sendStepUpCode,
  submitStatusChange,
} from "./status-actions"

const SHIPMENT = "7f3c9a10-1b2c-4d3e-8f90-a1b2c3d4e548"
const REASON =
  "El transportista no responde hace dos días y el emisor pidió destrabarlo"
const DONE = {
  shipmentId: SHIPMENT,
  fromStatus: "assigned",
  toStatus: "cancelled",
  kind: "forced",
  replayed: false,
}
const base = {
  targetStatus: "cancelled",
  expectedStatus: "assigned",
  reason: `  ${REASON}  `,
  idempotencyKey: "9b2f7c1e-4d3a-4f6b-8c1d-2e5a7b9c0d1e",
}

afterEach(() => vi.clearAllMocks())

describe("loadStatusOptions", () => {
  it("devuelve las opciones del backend", async () => {
    mocks.getStatusOptions.mockResolvedValue({
      current: "published",
      options: [],
    })
    expect(await loadStatusOptions(SHIPMENT)).toEqual({
      ok: true,
      data: { current: "published", options: [] },
    })
    expect(mocks.getStatusOptions).toHaveBeenCalledWith(SHIPMENT)
  })

  it("un id que no es UUID es 400 y no llama al backend", async () => {
    expect(await loadStatusOptions("no-es-uuid")).toMatchObject({
      ok: false,
      status: 400,
    })
    expect(mocks.getStatusOptions).not.toHaveBeenCalled()
  })

  it("sin sesión de admin devuelve el error como dato", async () => {
    mocks.requireAdmin.mockRejectedValueOnce(
      new ApiError(401, "AUTH_TOKEN_INVALID", "x")
    )
    expect(await loadStatusOptions(SHIPMENT)).toMatchObject({
      ok: false,
      status: 401,
    })
    expect(mocks.getStatusOptions).not.toHaveBeenCalled()
  })

  it("un 404 del envío vuelve como error con su código", async () => {
    mocks.getStatusOptions.mockRejectedValue(
      new ApiError(404, "NOT_FOUND", "x")
    )
    expect(await loadStatusOptions(SHIPMENT)).toMatchObject({
      ok: false,
      code: "NOT_FOUND",
      status: 404,
    })
  })
})

describe("sendStepUpCode", () => {
  it("pide el código para este envío y destino", async () => {
    mocks.requestStepUp.mockResolvedValue({ challengeId: "c1" })
    expect(await sendStepUpCode(SHIPMENT, "cancelled")).toEqual({
      ok: true,
      data: { challengeId: "c1" },
    })
    expect(mocks.requestStepUp).toHaveBeenCalledWith({
      shipmentId: SHIPMENT,
      targetStatus: "cancelled",
    })
  })

  it("un destino que no es un estado es 400", async () => {
    expect(await sendStepUpCode(SHIPMENT, "volando")).toMatchObject({
      ok: false,
      status: 400,
    })
    // Claves del prototipo de Object: no son estados.
    expect(await sendStepUpCode(SHIPMENT, "constructor")).toMatchObject({
      ok: false,
      status: 400,
    })
    expect(mocks.requestStepUp).not.toHaveBeenCalled()
  })

  it("un rechazo del backend (429 o 422) vuelve con su texto", async () => {
    mocks.requestStepUp.mockRejectedValue(
      new ApiError(429, "RATE_LIMIT_EXCEEDED", "x")
    )
    expect(await sendStepUpCode(SHIPMENT, "cancelled")).toMatchObject({
      ok: false,
      code: "RATE_LIMIT_EXCEEDED",
      error: expect.stringContaining("demasiados intentos"),
    })
  })
})

describe("submitStatusChange — validación previa", () => {
  it.each([
    ["motivo corto", { reason: "muy corto" }],
    ["motivo de solo espacios", { reason: " ".repeat(40) }],
    ["motivo demasiado largo", { reason: "x".repeat(501) }],
    ["destino inválido", { targetStatus: "volando" }],
    // Claves del prototipo de Object: no son estados aunque `in` las encuentre.
    ["destino 'constructor'", { targetStatus: "constructor" }],
    ["destino 'toString'", { targetStatus: "toString" }],
    ["estado esperado '__proto__'", { expectedStatus: "__proto__" }],
    ["estado esperado inválido", { expectedStatus: "volando" }],
    ["clave de idempotencia corta", { idempotencyKey: "abc" }],
    [
      "código de 6 dígitos mal formado",
      { otp: { challengeId: "c1", code: "12ab" } },
    ],
  ])("%s: 400 sin llamar al backend", async (_label, patch) => {
    const result = await submitStatusChange(SHIPMENT, { ...base, ...patch })
    expect(result).toMatchObject({ ok: false, status: 400 })
    expect(mocks.verifyStepUp).not.toHaveBeenCalled()
    expect(mocks.changeStatus).not.toHaveBeenCalled()
  })
})

describe("submitStatusChange", () => {
  it("sin segundo factor: manda el motivo recortado, refresca el detalle y no manda token", async () => {
    mocks.changeStatus.mockResolvedValue(DONE)
    const result = await submitStatusChange(SHIPMENT, base)
    expect(result).toEqual({ ok: true, data: DONE })
    const body = mocks.changeStatus.mock.calls[0][1]
    expect(body).toEqual({
      targetStatus: "cancelled",
      expectedStatus: "assigned",
      reason: REASON,
      idempotencyKey: base.idempotencyKey,
    })
    expect(mocks.verifyStepUp).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/shipments/${SHIPMENT}`)
  })

  it("con el código por email: lo verifica primero y manda el token y el código del envío", async () => {
    mocks.verifyStepUp.mockResolvedValue({ stepUpToken: "t".repeat(43) })
    mocks.changeStatus.mockResolvedValue(DONE)
    await submitStatusChange(SHIPMENT, {
      ...base,
      typedCode: "MOVO-34548",
      otp: { challengeId: "c1", code: "123456" },
    })
    expect(mocks.verifyStepUp).toHaveBeenCalledWith({
      shipmentId: SHIPMENT,
      targetStatus: "cancelled",
      challengeId: "c1",
      code: "123456",
    })
    expect(mocks.changeStatus.mock.calls[0][1]).toMatchObject({
      typedCode: "MOVO-34548",
      stepUpToken: "t".repeat(43),
    })
  })

  it("si el código no verifica, no intenta el cambio y no devuelve token", async () => {
    mocks.verifyStepUp.mockRejectedValue(
      new ApiError(401, "STEP_UP_INVALID", "x")
    )
    const result = await submitStatusChange(SHIPMENT, {
      ...base,
      otp: { challengeId: "c1", code: "123456" },
    })
    expect(result).toMatchObject({ ok: false, code: "STEP_UP_INVALID" })
    expect(result).not.toHaveProperty("stepUpToken")
    expect(mocks.changeStatus).not.toHaveBeenCalled()
  })

  it("un rechazo de negocio devuelve el token verificado para reintentar sin otro código", async () => {
    mocks.verifyStepUp.mockResolvedValue({ stepUpToken: "t".repeat(43) })
    mocks.changeStatus.mockRejectedValue(
      new ApiError(422, "HOLD_NOT_AUTHORIZED", "x")
    )
    const result = await submitStatusChange(SHIPMENT, {
      ...base,
      otp: { challengeId: "c1", code: "123456" },
    })
    expect(result).toMatchObject({
      ok: false,
      code: "HOLD_NOT_AUTHORIZED",
      stepUpToken: "t".repeat(43),
    })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("al reintentar con un token ya verificado no vuelve a verificar nada", async () => {
    mocks.changeStatus.mockResolvedValue(DONE)
    await submitStatusChange(SHIPMENT, { ...base, stepUpToken: "t".repeat(43) })
    expect(mocks.verifyStepUp).not.toHaveBeenCalled()
    expect(mocks.changeStatus.mock.calls[0][1]).toMatchObject({
      stepUpToken: "t".repeat(43),
    })
  })

  it("un token que el backend rechaza (STEP_UP_INVALID) no se devuelve", async () => {
    mocks.changeStatus.mockRejectedValue(
      new ApiError(401, "STEP_UP_INVALID", "x")
    )
    const result = await submitStatusChange(SHIPMENT, {
      ...base,
      stepUpToken: "t".repeat(43),
    })
    expect(result).toMatchObject({ ok: false, code: "STEP_UP_INVALID" })
    expect(result).not.toHaveProperty("stepUpToken")
  })

  it("un currentStatus que no es un estado (p. ej. 'constructor') se ignora en vez de romper el modal", async () => {
    mocks.changeStatus.mockRejectedValue(
      new ApiError(409, "STATUS_CHANGED", "x", { currentStatus: "constructor" })
    )
    const result = await submitStatusChange(SHIPMENT, base)
    expect(result).toMatchObject({ ok: false, code: "STATUS_CHANGED" })
    expect(result).not.toHaveProperty("currentStatus")
  })

  it("un 5xx al verificar el código no dice que el cambio pudo aplicarse (todavía no se intentó)", async () => {
    mocks.verifyStepUp.mockRejectedValue(
      new ApiError(502, "USERS_SERVICE_UNAVAILABLE", "x")
    )
    const result = await submitStatusChange(SHIPMENT, {
      ...base,
      otp: { challengeId: "c1", code: "123456" },
    })
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("verificar el código"),
    })
    expect(result).not.toHaveProperty("unconfirmed")
    expect(mocks.changeStatus).not.toHaveBeenCalled()
  })

  it("STATUS_CHANGED trae el estado actual", async () => {
    mocks.changeStatus.mockRejectedValue(
      new ApiError(409, "STATUS_CHANGED", "x", { currentStatus: "cancelled" })
    )
    expect(await submitStatusChange(SHIPMENT, base)).toMatchObject({
      ok: false,
      code: "STATUS_CHANGED",
      currentStatus: "cancelled",
    })
  })

  it("TRANSITION_NOT_ALLOWED muestra el motivo que da el backend", async () => {
    mocks.changeStatus.mockRejectedValue(
      new ApiError(422, "TRANSITION_NOT_ALLOWED", "x", {
        reason: "Un envío cancelado no se puede reabrir.",
      })
    )
    expect(await submitStatusChange(SHIPMENT, base)).toMatchObject({
      ok: false,
      error: "Un envío cancelado no se puede reabrir.",
    })
  })

  it("FORCE_STATUS_EFFECT_FAILED (502 conocido) tiene su texto y no se toma por caída", async () => {
    mocks.changeStatus.mockRejectedValue(
      new ApiError(502, "FORCE_STATUS_EFFECT_FAILED", "x")
    )
    const result = await submitStatusChange(SHIPMENT, base)
    expect(result).toMatchObject({
      ok: false,
      code: "FORCE_STATUS_EFFECT_FAILED",
    })
    expect(result).not.toHaveProperty("unconfirmed")
  })

  it("un 5xx desconocido avisa que pudo aplicarse, refresca el detalle y no devuelve token", async () => {
    mocks.verifyStepUp.mockResolvedValue({ stepUpToken: "t".repeat(43) })
    mocks.changeStatus.mockRejectedValue(
      new ApiError(502, "SHIPMENTS_SERVICE_UNAVAILABLE", "x")
    )
    const result = await submitStatusChange(SHIPMENT, {
      ...base,
      otp: { challengeId: "c1", code: "123456" },
    })
    expect(result).toMatchObject({ ok: false, unconfirmed: true, status: 502 })
    expect(result).not.toHaveProperty("stepUpToken")
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/shipments/${SHIPMENT}`)
  })
})
