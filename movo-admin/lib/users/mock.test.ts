import { afterEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@movo/shared/src/errors/api-error"

vi.mock("server-only", () => ({}))
import { SEEDS, uuid } from "./fixtures"
import {
  mockAddNote,
  mockAdjustLedger,
  mockEnabled,
  mockGetProfile,
  mockGetSection,
  mockRevokeSessions,
  mockSearchUsers,
  mockUpdateContact,
} from "./mock"

const MARCOS = uuid("Marcos Vera")

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("modo fixtures", () => {
  it("solo se activa con MOVO_ADMIN_MOCK=1 y nunca en producción", () => {
    vi.stubEnv("MOVO_ADMIN_MOCK", "1")
    vi.stubEnv("NODE_ENV", "development")
    expect(mockEnabled()).toBe(true)
    vi.stubEnv("NODE_ENV", "production")
    expect(mockEnabled()).toBe(false)
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("MOVO_ADMIN_MOCK", "")
    expect(mockEnabled()).toBe(false)
  })
})

describe("búsqueda", () => {
  it("sin búsqueda lista a todos, más recientes primero, de a 10", async () => {
    vi.stubEnv("MOVO_ADMIN_MOCK_LATENCY_MS", "0")
    const page = await mockSearchUsers("", 1)
    expect(page.items).toHaveLength(10)
    expect(page.total).toBe(26)
    expect(page.items[0].matchedBy).toBeNull()
    const dates = page.items.map((u) => u.createdAt)
    expect([...dates].sort().reverse()).toEqual(dates)
  })

  it.each([
    ["nombre sin tildes", "hernan molina", "name"],
    ["email", "eze.rojas@hotmail", "email"],
    ["DNI sin puntos", "33812405", "dni"],
    ["teléfono sin prefijo", "351 612-4410", "phone"],
    ["teléfono con +54 9", "+54 9 351 612-4410", "phone"],
    ["teléfono con 0", "0351 612 4410", "phone"],
  ])("encuentra por %s", async (_label, q, by) => {
    vi.stubEnv("MOVO_ADMIN_MOCK_LATENCY_MS", "0")
    const page = await mockSearchUsers(q, 1)
    expect(page.items.length).toBeGreaterThan(0)
    expect(page.items[0].matchedBy).toBe(by)
  })

  it("incluye las cuentas dadas de baja, marcadas", async () => {
    vi.stubEnv("MOVO_ADMIN_MOCK_LATENCY_MS", "0")
    const page = await mockSearchUsers("Lorena Paz", 1)
    expect(page.items[0].accountStatus).toBe("deleted")
  })

  it("sin coincidencias devuelve la lista vacía", async () => {
    vi.stubEnv("MOVO_ADMIN_MOCK_LATENCY_MS", "0")
    expect((await mockSearchUsers("zzzzzz", 1)).total).toBe(0)
  })
})

describe("ficha", () => {
  it("un usuario inexistente es 404 USER_NOT_FOUND", async () => {
    vi.stubEnv("MOVO_ADMIN_MOCK_LATENCY_MS", "0")
    await expect(mockGetProfile(uuid("nadie"))).rejects.toMatchObject({
      statusCode: 404,
      code: "USER_NOT_FOUND",
    })
  })

  it("Marcos tiene envíos, reportes y bloqueos", async () => {
    vi.stubEnv("MOVO_ADMIN_MOCK_LATENCY_MS", "0")
    const ships = await mockGetSection(MARCOS, "shipments", { role: "carrier" })
    expect(ships.counts.carrier).toBe(9)
    expect(ships.items).toHaveLength(5)
    const mod = await mockGetSection(MARCOS, "moderation", {})
    expect(mod.reports.received).toHaveLength(2)
    expect(mod.blocks.made).toHaveLength(1)
    expect((await mockGetSection(MARCOS, "ledger", {})).balanceArs).toBe(940)
  })

  it("falla una sección con 502 la primera vez y el reintento anda", async () => {
    vi.stubEnv("MOVO_ADMIN_MOCK_LATENCY_MS", "0")
    vi.stubEnv("MOVO_ADMIN_MOCK_FAIL", "kyc")
    const id = uuid("Diego Funes")
    const error = await mockGetSection(id, "kyc", {}).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ statusCode: 502 })
    // El resto de las secciones no se ve afectado.
    await expect(mockGetSection(id, "vehicle", {})).resolves.toBeTruthy()
    await expect(mockGetSection(id, "kyc", {})).resolves.toBeTruthy()
  })

  it("con ! la sección falla siempre", async () => {
    vi.stubEnv("MOVO_ADMIN_MOCK_LATENCY_MS", "0")
    vi.stubEnv("MOVO_ADMIN_MOCK_FAIL", "ledger!")
    const id = uuid("Diego Funes")
    await expect(mockGetSection(id, "ledger", {})).rejects.toMatchObject({
      statusCode: 502,
    })
    await expect(mockGetSection(id, "ledger", {})).rejects.toMatchObject({
      statusCode: 502,
    })
  })
})

describe("listas que crecen", () => {
  const DIEGO = uuid("Diego Funes")

  it("la cuenta corriente pagina por cursor y el saldo cuenta todo", async () => {
    vi.stubEnv("MOVO_ADMIN_MOCK_LATENCY_MS", "0")
    const first = await mockGetSection(DIEGO, "ledger", { limit: 20 })
    expect(first.items).toHaveLength(20)
    expect(first.nextCursor).toBe("20")
    const last = await mockGetSection(DIEGO, "ledger", {
      cursor: "40",
      limit: 20,
    })
    expect(last.items).toHaveLength(5)
    expect(last.nextCursor).toBeNull()
    expect(last.balanceArs).toBe(first.balanceArs)
  })

  it("la bitácora pagina por cursor", async () => {
    vi.stubEnv("MOVO_ADMIN_MOCK_LATENCY_MS", "0")
    const first = await mockGetSection(DIEGO, "audit", { limit: 20 })
    expect(first.items).toHaveLength(20)
    expect(first.nextCursor).toBe("20")
  })

  it("moderación trae a lo sumo las 50 más recientes y avisa el total", async () => {
    vi.stubEnv("MOVO_ADMIN_MOCK_LATENCY_MS", "0")
    const mod = await mockGetSection(DIEGO, "moderation", {})
    expect(mod.reports.received).toHaveLength(50)
    expect(mod.totals.reportsReceived).toBe(55)
    expect(mod.totals.blocksMade).toBe(12)
  })

  it("las calificaciones paginan hasta el total", async () => {
    vi.stubEnv("MOVO_ADMIN_MOCK_LATENCY_MS", "0")
    const r = await mockGetSection(DIEGO, "ratings", { page: 2, pageSize: 5 })
    expect(r.count).toBe(58)
    expect(r.items.length).toBeGreaterThan(0)
  })
})

describe("acciones de soporte en modo fixtures", () => {
  const actor = {
    adminId: uuid("Admin de prueba"),
    adminName: "Admin de prueba",
  }
  // Hernán no lo toca ningún otro test: el estado del mock vive en memoria del proceso.
  const HERNAN = uuid("Hernán Molina")
  const FUNES = uuid("Diego Funes")
  const NO_LATENCY = () => vi.stubEnv("MOVO_ADMIN_MOCK_LATENCY_MS", "0")

  it("cerrar sesiones deja una fila aplicada en la bitácora", async () => {
    NO_LATENCY()
    const result = await mockRevokeSessions(HERNAN, "Celular robado", actor)
    expect(result.revokedRefreshTokens).toBeGreaterThan(0)
    const audit = await mockGetSection(HERNAN, "audit", { limit: 5 })
    expect(audit.items[0]).toMatchObject({
      action: "user.sessions_revoke",
      reason: "Celular robado",
      outcome: "succeeded",
      adminName: "Admin de prueba",
    })
  })

  it("un admin no puede actuar sobre su propia cuenta", async () => {
    NO_LATENCY()
    await expect(
      mockRevokeSessions(HERNAN, "x", { ...actor, adminId: HERNAN })
    ).rejects.toMatchObject({ code: "ADMIN_CONFLICT_OF_INTEREST" })
  })

  it("cambiar el email lo deja sin verificar y se ve en la ficha", async () => {
    NO_LATENCY()
    const before = await mockGetProfile(FUNES)
    const result = await mockUpdateContact(
      FUNES,
      {
        field: "email",
        newValue: "nuevo.funes@gmail.com",
        expectedCurrent: before.email,
        reason: "Pidió el cambio",
      },
      actor
    )
    expect(result).toMatchObject({
      email: "nuevo.funes@gmail.com",
      emailVerified: false,
      phone: before.phone,
    })
    const after = await mockGetProfile(FUNES)
    expect(after.email).toBe("nuevo.funes@gmail.com")
    expect(after.emailVerified).toBe(false)
  })

  it("rechaza un valor viejo, el mismo valor y uno ya usado", async () => {
    NO_LATENCY()
    const profile = await mockGetProfile(HERNAN)
    const body = {
      field: "email" as const,
      newValue: "otro@gmail.com",
      expectedCurrent: profile.email,
      reason: "x",
    }
    await expect(
      mockUpdateContact(
        HERNAN,
        { ...body, expectedCurrent: "viejo@gmail.com" },
        actor
      )
    ).rejects.toMatchObject({ code: "CONTACT_CHANGED" })
    await expect(
      mockUpdateContact(HERNAN, { ...body, newValue: profile.email }, actor)
    ).rejects.toMatchObject({ code: "CONTACT_UNCHANGED" })
    const marcos = await mockGetProfile(uuid("Marcos Vera"))
    await expect(
      mockUpdateContact(HERNAN, { ...body, newValue: marcos.email }, actor)
    ).rejects.toMatchObject({ code: "EMAIL_ALREADY_IN_USE" })
    await expect(
      mockUpdateContact(
        HERNAN,
        {
          ...body,
          field: "phone",
          newValue: marcos.phone,
          expectedCurrent: profile.phone,
        },
        actor
      )
    ).rejects.toMatchObject({ code: "PHONE_ALREADY_IN_USE" })
  })

  it("un ajuste mueve el saldo, aparece primero y es idempotente", async () => {
    NO_LATENCY()
    const ledger = await mockGetSection(HERNAN, "ledger", { limit: 20 })
    const key = "9b2f7c1e-4d3a-4f6b-8c1d-2e5a7b9c0d1e"
    const body = {
      amountArs: 500,
      reason: "Cobro que faltó",
      idempotencyKey: key,
    }
    const first = await mockAdjustLedger(HERNAN, body, actor)
    expect(first.balanceArs).toBe(ledger.balanceArs + 500)
    expect(first.entry).toMatchObject({
      type: "manual_adjustment",
      amountArs: 500,
      adminName: "Admin de prueba",
    })
    const again = await mockAdjustLedger(HERNAN, body, actor)
    expect(again.entry.id).toBe(first.entry.id)
    expect(again.balanceArs).toBe(first.balanceArs)
    await expect(
      mockAdjustLedger(HERNAN, { ...body, amountArs: 600 }, actor)
    ).rejects.toMatchObject({ code: "LEDGER_IDEMPOTENCY_CONFLICT" })
    const after = await mockGetSection(HERNAN, "ledger", { limit: 20 })
    expect(after.balanceArs).toBe(ledger.balanceArs + 500)
    expect(after.items[0].id).toBe(first.entry.id)
  })

  it("redondea a centavos el saldo nuevo y el reintento del ajuste", async () => {
    NO_LATENCY()
    const before = await mockGetSection(HERNAN, "ledger", { limit: 20 })
    const key = "2b2f7c1e-4d3a-4f6b-8c1d-2e5a7b9c0d1e"
    const body = { amountArs: 0.3, reason: "Centavos", idempotencyKey: key }
    const result = await mockAdjustLedger(HERNAN, body, actor)
    const expected = Math.round((before.balanceArs + 0.3) * 100) / 100
    expect(result.balanceArs).toBe(expected)
    expect((await mockAdjustLedger(HERNAN, body, actor)).balanceArs).toBe(expected)
    expect((await mockGetSection(HERNAN, "ledger", { limit: 20 })).balanceArs).toBe(expected)
  })

  it("rechaza un ajuste en cero o por encima del tope", async () => {
    NO_LATENCY()
    const key = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f"
    for (const amountArs of [0, 1_000_000])
      await expect(
        mockAdjustLedger(
          HERNAN,
          {
            amountArs,
            reason: "x",
            idempotencyKey: `${amountArs}${key}`.slice(-36),
          },
          actor
        )
      ).rejects.toMatchObject({ code: "AMOUNT_OUT_OF_RANGE" })
  })

  it("las notas nuevas van primero y una cuenta eliminada igual las admite", async () => {
    NO_LATENCY()
    const before = await mockGetSection(HERNAN, "notes", {})
    const note = await mockAddNote(HERNAN, "Llamó por la disputa", actor)
    const after = await mockGetSection(HERNAN, "notes", {})
    expect(after.items[0]).toMatchObject({
      id: note.id,
      adminName: "Admin de prueba",
    })
    expect(after.items).toHaveLength(before.items.length + 1)
    const deleted = SEEDS.find((u) => u.status === "deleted")
    expect(deleted).toBeDefined()
    await expect(mockAddNote(deleted!.id, "Nota", actor)).resolves.toBeDefined()
    await expect(
      mockRevokeSessions(deleted!.id, "x", actor)
    ).rejects.toMatchObject({ code: "USER_DELETED" })
  })

  it("MOVO_ADMIN_MOCK_FAIL=actions! simula el servicio caído y deja la fila sin confirmar", async () => {
    NO_LATENCY()
    vi.stubEnv("MOVO_ADMIN_MOCK_FAIL", "actions!")
    await expect(mockRevokeSessions(HERNAN, "x", actor)).rejects.toMatchObject({
      statusCode: 502,
    })
    vi.stubEnv("MOVO_ADMIN_MOCK_FAIL", "")
    const audit = await mockGetSection(HERNAN, "audit", { limit: 1 })
    expect(audit.items[0].outcome).toBe("unknown")
  })
})
