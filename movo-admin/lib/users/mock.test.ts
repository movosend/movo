import { afterEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@movo/shared/src/errors/api-error"

vi.mock("server-only", () => ({}))
import { uuid } from "./fixtures"
import {
  mockEnabled,
  mockGetProfile,
  mockGetSection,
  mockSearchUsers,
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
