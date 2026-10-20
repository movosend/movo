import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(async () => ({
    id: "11111111-1111-1111-1111-111111111111",
    fullName: "Ada Admin",
    email: "ada@movo.test",
  })),
  revalidatePath: vi.fn(),
  revokeUserSessions: vi.fn(async () => ({ revokedRefreshTokens: 3 })),
  updateUserContact: vi.fn(async () => ({})),
  adjustUserLedger: vi.fn(async () => ({})),
  addUserNote: vi.fn(async () => ({})),
  loadSection: vi.fn(async () => ({ ok: true, data: { items: [] } })),
}))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("@/lib/auth/api", () => ({ publicError: () => "error público" }))
vi.mock("@/lib/auth/session", () => ({
  assertOrigin: async () => {},
  requireAdmin: mocks.requireAdmin,
}))
vi.mock("@/lib/users/mutations", () => ({
  revokeUserSessions: mocks.revokeUserSessions,
  updateUserContact: mocks.updateUserContact,
  adjustUserLedger: mocks.adjustUserLedger,
  addUserNote: mocks.addUserNote,
}))
vi.mock("@/lib/users/load", () => ({ loadSection: mocks.loadSection }))

import { ApiError } from "@movo/shared/src/errors/api-error"
import {
  addNote,
  adjustLedger,
  loadNotesMore,
  revokeSessions,
  updateContact,
} from "./account-actions"

const USER = "7f3c9a10-1b2c-4d3e-8f90-a1b2c3d4e5f6"
const KEY = "9b2f7c1e-4d3a-4f6b-8c1d-2e5a7b9c0d1e"
const ACTOR = {
  adminId: "11111111-1111-1111-1111-111111111111",
  adminName: "Ada Admin",
}

afterEach(() => vi.clearAllMocks())

describe("cerrar sesiones", () => {
  it("manda el motivo recortado con el admin que actúa y refresca la ficha", async () => {
    const result = await revokeSessions(USER, "  Celular robado  ")
    expect(result).toEqual({ ok: true, data: { revokedRefreshTokens: 3 } })
    expect(mocks.revokeUserSessions).toHaveBeenCalledWith(
      USER,
      { reason: "Celular robado" },
      ACTOR
    )
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/users/${USER}`)
  })

  it.each(["", "   ", "x".repeat(501)])(
    "corta antes de llamar al servicio con el motivo %j",
    async (reason) => {
      const result = await revokeSessions(USER, reason)
      expect(result).toMatchObject({ ok: false, status: 400 })
      expect(mocks.revokeUserSessions).not.toHaveBeenCalled()
    }
  )

  it("rechaza un id que no es UUID", async () => {
    expect(await revokeSessions("../etc", "x")).toMatchObject({ ok: false })
    expect(mocks.revokeUserSessions).not.toHaveBeenCalled()
  })

  it("sin sesión de admin no llama al servicio", async () => {
    mocks.requireAdmin.mockRejectedValueOnce(
      new ApiError(401, "AUTH_TOKEN_INVALID", "x")
    )
    const result = await revokeSessions(USER, "x")
    expect(result).toMatchObject({ ok: false, status: 401 })
    expect(mocks.revokeUserSessions).not.toHaveBeenCalled()
  })

  it("un conflicto de interés vuelve como dato y no refresca", async () => {
    mocks.revokeUserSessions.mockRejectedValueOnce(
      new ApiError(403, "ADMIN_CONFLICT_OF_INTEREST", "x")
    )
    const result = await revokeSessions(USER, "x")
    expect(result).toMatchObject({
      ok: false,
      code: "ADMIN_CONFLICT_OF_INTEREST",
    })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("un servicio caído se marca sin confirmar y refresca para ver la bitácora", async () => {
    mocks.revokeUserSessions.mockRejectedValueOnce(
      new ApiError(502, "USERS_SERVICE_UNAVAILABLE", "x")
    )
    const result = await revokeSessions(USER, "x")
    expect(result).toMatchObject({ ok: false, unconfirmed: true })
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/users/${USER}`)
  })
})

describe("cambiar email o teléfono", () => {
  it("normaliza el valor nuevo y manda lo que el admin vio como expectedCurrent", async () => {
    await updateContact(USER, {
      field: "phone",
      newValue: "0351 612 4410",
      expectedCurrent: "+5493510000000",
      reason: " Tras validar identidad ",
    })
    expect(mocks.updateUserContact).toHaveBeenCalledWith(
      USER,
      {
        field: "phone",
        newValue: "+5493516124410",
        expectedCurrent: "+5493510000000",
        reason: "Tras validar identidad",
      },
      ACTOR
    )
    await updateContact(USER, {
      field: "email",
      newValue: "  Nuevo@Gmail.COM ",
      expectedCurrent: "viejo@gmail.com",
      reason: "x",
    })
    expect(mocks.updateUserContact).toHaveBeenLastCalledWith(
      USER,
      expect.objectContaining({ newValue: "nuevo@gmail.com" }),
      ACTOR
    )
  })

  it.each([
    [
      "campo desconocido",
      { field: "dni", newValue: "1", expectedCurrent: "a", reason: "x" },
    ],
    [
      "email inválido",
      {
        field: "email",
        newValue: "nope",
        expectedCurrent: "a@b.co",
        reason: "x",
      },
    ],
    [
      "teléfono inválido",
      {
        field: "phone",
        newValue: "123",
        expectedCurrent: "+5493510000000",
        reason: "x",
      },
    ],
    [
      "sin motivo",
      {
        field: "email",
        newValue: "a@b.co",
        expectedCurrent: "c@d.co",
        reason: " ",
      },
    ],
    [
      "sin valor actual",
      { field: "email", newValue: "a@b.co", expectedCurrent: "", reason: "x" },
    ],
  ])("rechaza %s sin llamar al servicio", async (_label, input) => {
    const result = await updateContact(
      USER,
      input as Parameters<typeof updateContact>[1]
    )
    expect(result).toMatchObject({ ok: false, status: 400 })
    expect(mocks.updateUserContact).not.toHaveBeenCalled()
  })

  it("traduce CONTACT_CHANGED conservando el código", async () => {
    mocks.updateUserContact.mockRejectedValueOnce(
      new ApiError(409, "CONTACT_CHANGED", "x")
    )
    const result = await updateContact(USER, {
      field: "email",
      newValue: "a@b.co",
      expectedCurrent: "c@d.co",
      reason: "x",
    })
    expect(result).toMatchObject({ ok: false, code: "CONTACT_CHANGED" })
  })
})

describe("ajustar el saldo", () => {
  it.each([19.99, 1.15, 9.95, 124.55])(
    "acepta el monto válido con centavos %s",
    async (amountArs) => {
      const result = await adjustLedger(USER, {
        amountArs,
        reason: "Corrección de saldo",
        idempotencyKey: KEY,
      })
      expect(result.ok).toBe(true)
      expect(mocks.adjustUserLedger).toHaveBeenCalledWith(
        USER,
        expect.objectContaining({ amountArs }),
        ACTOR
      )
    }
  )

  it("manda el monto con signo y la clave de idempotencia", async () => {
    await adjustLedger(USER, {
      amountArs: -120.5,
      reason: "Cobro de más",
      idempotencyKey: KEY,
    })
    expect(mocks.adjustUserLedger).toHaveBeenCalledWith(
      USER,
      { amountArs: -120.5, reason: "Cobro de más", idempotencyKey: KEY },
      ACTOR
    )
  })

  it.each([
    ["cero", 0],
    ["NaN", Number.NaN],
    ["tres decimales", 10.123],
    ["fuera de rango", 50_000_000],
  ])("rechaza un monto %s", async (_label, amountArs) => {
    const result = await adjustLedger(USER, {
      amountArs,
      reason: "x",
      idempotencyKey: KEY,
    })
    expect(result).toMatchObject({ ok: false, status: 400 })
    expect(mocks.adjustUserLedger).not.toHaveBeenCalled()
  })

  it("exige motivo y una clave UUID", async () => {
    expect(
      await adjustLedger(USER, {
        amountArs: 5,
        reason: "",
        idempotencyKey: KEY,
      })
    ).toMatchObject({ ok: false })
    expect(
      await adjustLedger(USER, {
        amountArs: 5,
        reason: "x",
        idempotencyKey: "no-uuid",
      })
    ).toMatchObject({ ok: false })
    expect(mocks.adjustUserLedger).not.toHaveBeenCalled()
  })
})

describe("notas", () => {
  it("guarda la nota recortada", async () => {
    await addNote(USER, "  Llamó por la disputa \n")
    expect(mocks.addUserNote).toHaveBeenCalledWith(
      USER,
      { body: "Llamó por la disputa" },
      ACTOR
    )
  })

  it.each(["", "  ", "x".repeat(1001)])("rechaza la nota %j", async (body) => {
    expect(await addNote(USER, body.slice(0, 1001))).toMatchObject({
      ok: false,
    })
    expect(mocks.addUserNote).not.toHaveBeenCalled()
  })

  it("'Ver más' valida el cursor y pide la siguiente página", async () => {
    expect(await loadNotesMore(USER, "ab c")).toEqual({
      ok: false,
      status: 400,
    })
    await loadNotesMore(USER, "20")
    expect(mocks.loadSection).toHaveBeenCalledWith(USER, "notes", {
      cursor: "20",
      limit: 20,
    })
  })
})
