import "server-only"
import { ApiError } from "@movo/shared/src/errors/api-error"
import type {
  AdminContactUpdateBody,
  AdminContactUpdateResult,
  AdminLedgerAdjustmentBody,
  AdminLedgerAdjustmentResult,
  AdminSessionsRevokeResult,
  AdminUserAuditEntry,
  AdminUserLedgerEntry,
  AdminUserListItem,
  AdminUserNote,
  AdminUserProfile,
} from "@movo/shared/src/types/admin-users"
import {
  MOCK_TODAY,
  mockAudit,
  mockDevices,
  mockKyc,
  mockLedger,
  mockModeration,
  mockNotes,
  mockProfile,
  mockRatings,
  mockSanctions,
  mockSearch,
  mockShipments,
  mockTrips,
  mockVehicle,
  SEEDS,
  seedById,
  uuid,
} from "./fixtures"
import {
  SECTION_SERVICE,
  type SectionKey,
  type SectionMap,
  type SectionParams,
} from "./sections"

/**
 * Modo fixtures (MOVO-295): `MOVO_ADMIN_MOCK=1` reemplaza solo la capa de datos de Usuarios
 * mientras `svc-admin` no tenga las rutas de MOVO-294. El login sigue yendo al gateway real.
 * Se ignora en producción para que nunca muestre datos inventados.
 *
 * `MOVO_ADMIN_MOCK_FAIL=kyc,ledger` hace fallar esas secciones con un 502 en la primera carga
 * (el reintento anda); con `!` al final (`kyc!`) fallan siempre. `MOVO_ADMIN_MOCK_LATENCY_MS`
 * fija la demora base (default 350 ms).
 */
export const mockEnabled = () =>
  process.env.MOVO_ADMIN_MOCK === "1" && process.env.NODE_ENV !== "production"

export const MOCK_NOW = MOCK_TODAY

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const base = () => {
  const n = Number(process.env.MOVO_ADMIN_MOCK_LATENCY_MS)
  return Number.isFinite(n) && n >= 0 ? n : 350
}
// Escalonado por sección, como el prototipo: las más pesadas tardan más y se ve el streaming.
const STAGGER: Record<SectionKey, number> = {
  kyc: 1.8,
  vehicle: 1.2,
  shipments: 2.7,
  trips: 1.5,
  ratings: 2.1,
  moderation: 3.2,
  suspensions: 1.7,
  ledger: 3.8,
  devices: 1.4,
  audit: 2.4,
  notes: 1.3,
}

const failed = new Set<string>()
function shouldFail(id: string, key: SectionKey): boolean {
  const spec = (process.env.MOVO_ADMIN_MOCK_FAIL ?? "")
    .split(",")
    .map((s) => s.trim())
  if (spec.includes(`${key}!`)) return true
  if (!spec.includes(key)) return false
  const k = `${id}:${key}`
  if (failed.has(k)) return false
  failed.add(k)
  return true
}

const userNotFound = () =>
  new ApiError(404, "USER_NOT_FOUND", "No existe el usuario.")

/**
 * Lo que cambian las acciones de soporte (MOVO-294) vive en memoria del proceso, por usuario: se
 * pierde al reiniciar el servidor de desarrollo, que es lo esperado en un modo de fixtures.
 */
interface MockChanges {
  contact?: Partial<
    Pick<
      AdminUserProfile,
      "email" | "emailVerified" | "phone" | "phoneVerified"
    >
  >
  ledger: AdminUserLedgerEntry[]
  audit: AdminUserAuditEntry[]
  notes: AdminUserNote[]
}
const changes = new Map<string, MockChanges>()
const changesOf = (id: string): MockChanges => {
  let c = changes.get(id)
  if (!c) changes.set(id, (c = { ledger: [], audit: [], notes: [] }))
  return c
}

export async function mockSearchUsers(q: string, page: number) {
  await sleep(base())
  const result = mockSearch(q, page, 10)
  return {
    ...result,
    items: result.items.map((item): AdminUserListItem => ({
      ...item,
      ...changes.get(item.id)?.contact,
    })),
  }
}

export async function mockGetProfile(id: string) {
  await sleep(base() * 0.6)
  const seed = seedById(id)
  if (!seed) throw userNotFound()
  return { ...mockProfile(seed), ...changes.get(id)?.contact }
}

export async function mockGetSection<K extends SectionKey>(
  id: string,
  key: K,
  params: SectionParams
): Promise<SectionMap[K]> {
  await sleep(base() * STAGGER[key])
  const seed = seedById(id)
  if (!seed) throw userNotFound()
  if (shouldFail(id, key))
    throw new ApiError(
      502,
      `${SECTION_SERVICE[key]}_SERVICE_UNAVAILABLE` as "INTERNAL_ERROR",
      "El servicio no respondió."
    )
  const page = params.page ?? 1
  const result: SectionMap[SectionKey] = (() => {
    switch (key) {
      case "kyc":
        return mockKyc(seed)
      case "vehicle":
        return mockVehicle(seed)
      case "shipments":
        return mockShipments(
          seed,
          params.role ?? "sender",
          page,
          params.pageSize ?? 5
        )
      case "trips":
        return mockTrips(seed, page, params.pageSize ?? 5)
      case "ratings":
        return mockRatings(seed, page, params.pageSize ?? 5)
      case "moderation":
        return mockModeration(seed)
      case "suspensions":
        return mockSanctions(seed)
      case "ledger": {
        const base = mockLedger(seed, params.cursor, params.limit)
        const mine = changes.get(id)?.ledger ?? []
        return {
          ...base,
          balanceArs: base.balanceArs + sum(mine),
          items: params.cursor ? base.items : [...mine, ...base.items],
        }
      }
      case "devices":
        return mockDevices(seed)
      case "audit": {
        const base = mockAudit(seed, params.cursor, params.limit)
        const mine = changes.get(id)?.audit ?? []
        return {
          ...base,
          items: params.cursor ? base.items : [...mine, ...base.items],
        }
      }
      case "notes": {
        const all = [...(changes.get(id)?.notes ?? []), ...mockNotes(seed)]
        const start = Number(params.cursor) || 0
        const end = start + (params.limit ?? 20)
        return {
          items: all.slice(start, end),
          nextCursor: end < all.length ? String(end) : null,
        }
      }
    }
  })()
  return result as SectionMap[K]
}

const sum = (rows: AdminUserLedgerEntry[]) =>
  rows.filter((r) => r.status !== "voided").reduce((a, r) => a + r.amountArs, 0)

export interface MockActor {
  adminId: string
  adminName: string
}

/** Lo que haría `runAdminAction`: conflicto de interés, usuario y cuenta, y una fila de bitácora. */
async function mockAction<T>(
  id: string,
  actor: MockActor,
  action: string,
  reason: string | null,
  run: () => T,
  { allowDeleted = false }: { allowDeleted?: boolean } = {}
): Promise<T> {
  await sleep(base() * 1.5)
  const seed = seedById(id)
  if (!seed) throw userNotFound()
  if (actor.adminId === id)
    throw new ApiError(
      403,
      "ADMIN_CONFLICT_OF_INTEREST",
      "Un admin no puede actuar sobre su propia cuenta."
    )
  const fail = (process.env.MOVO_ADMIN_MOCK_FAIL ?? "")
    .split(",")
    .map((x) => x.trim())
  const log = (outcome: AdminUserAuditEntry["outcome"], errorCode?: string) =>
    changesOf(id).audit.unshift({
      id: uuid(`${id}${action}${Date.now()}${Math.random()}`),
      adminId: actor.adminId,
      adminName: actor.adminName,
      action,
      reason,
      outcome,
      errorCode: errorCode ?? null,
      createdAt: new Date().toISOString(),
    })
  if (fail.includes("actions!")) {
    log("unknown", "USERS_SERVICE_UNAVAILABLE")
    throw new ApiError(
      502,
      "USERS_SERVICE_UNAVAILABLE",
      "El servicio no respondió."
    )
  }
  try {
    if (!allowDeleted && seed.status === "deleted")
      throw new ApiError(409, "USER_DELETED", "La cuenta está eliminada.")
    const result = run()
    log("succeeded")
    return result
  } catch (error) {
    if (error instanceof ApiError) log("failed", error.code)
    throw error
  }
}

export function mockRevokeSessions(
  id: string,
  reason: string,
  actor: MockActor
): Promise<AdminSessionsRevokeResult> {
  return mockAction(id, actor, "user.sessions_revoke", reason, () => ({
    revokedRefreshTokens: 2 + (id.charCodeAt(0) % 3),
  }))
}

const digitsOnly = (v: string) => v.replace(/\D/g, "")

export function mockUpdateContact(
  id: string,
  body: AdminContactUpdateBody,
  actor: MockActor
): Promise<AdminContactUpdateResult> {
  return mockAction(id, actor, "user.contact_update", body.reason, () => {
    const seed = seedById(id)!
    const state = changesOf(id)
    const profile = { ...mockProfileOf(id), ...state.contact }
    const current = body.field === "email" ? profile.email : profile.phone
    if (body.expectedCurrent !== current)
      throw new ApiError(409, "CONTACT_CHANGED", "El dato cambió.")
    if (body.newValue === current)
      throw new ApiError(400, "CONTACT_UNCHANGED", "Es el mismo valor.")
    const taken = SEEDS.some(
      (other) =>
        other.id !== seed.id &&
        (body.field === "email"
          ? other.email.toLowerCase() === body.newValue
          : digitsOnly(other.phone) === digitsOnly(body.newValue))
    )
    if (taken)
      throw new ApiError(
        409,
        body.field === "email"
          ? "EMAIL_ALREADY_IN_USE"
          : "PHONE_ALREADY_IN_USE",
        "Ya está en uso."
      )
    state.contact = {
      ...state.contact,
      ...(body.field === "email"
        ? { email: body.newValue, emailVerified: false }
        : { phone: body.newValue, phoneVerified: false }),
    }
    const next = { ...profile, ...state.contact }
    return {
      email: next.email,
      emailVerified: next.emailVerified,
      phone: next.phone,
      phoneVerified: next.phoneVerified,
      revokedRefreshTokens: 2,
    }
  })
}

const mockProfileOf = (id: string) => mockProfile(seedById(id)!)

/** Tope de los ajustes en modo fixtures (en producción lo fija `ADMIN_LEDGER_ADJUSTMENT_MAX_ARS`). */
export const MOCK_LEDGER_ADJUSTMENT_MAX_ARS = 100_000

export function mockAdjustLedger(
  id: string,
  body: AdminLedgerAdjustmentBody,
  actor: MockActor
): Promise<AdminLedgerAdjustmentResult> {
  return mockAction(id, actor, "user.ledger_adjust", body.reason, () => {
    const state = changesOf(id)
    const entryId = uuid(`${id}${body.idempotencyKey}`)
    const existing = state.ledger.find((e) => e.id === entryId)
    const base = mockLedger(seedById(id)!).balanceArs
    if (existing) {
      if (existing.amountArs !== body.amountArs)
        throw new ApiError(
          409,
          "LEDGER_IDEMPOTENCY_CONFLICT",
          "La operación ya existe con otro monto."
        )
      return { entry: existing, balanceArs: base + sum(state.ledger) }
    }
    if (
      body.amountArs === 0 ||
      Math.abs(body.amountArs) > MOCK_LEDGER_ADJUSTMENT_MAX_ARS
    )
      throw new ApiError(422, "AMOUNT_OUT_OF_RANGE", "Monto fuera de rango.")
    const entry: AdminUserLedgerEntry = {
      id: entryId,
      type: "manual_adjustment",
      amountArs: body.amountArs,
      status: "settled",
      shipmentId: null,
      reason: body.reason,
      adminName: actor.adminName,
      createdAt: new Date().toISOString(),
    }
    state.ledger.unshift(entry)
    return { entry, balanceArs: base + sum(state.ledger) }
  })
}

export function mockAddNote(
  id: string,
  body: string,
  actor: MockActor
): Promise<AdminUserNote> {
  return mockAction(
    id,
    actor,
    "user.note_add",
    null,
    () => {
      const note: AdminUserNote = {
        id: uuid(`${id}note${Date.now()}${Math.random()}`),
        body,
        adminId: actor.adminId,
        adminName: actor.adminName,
        createdAt: new Date().toISOString(),
      }
      changesOf(id).notes.unshift(note)
      return note
    },
    { allowDeleted: true }
  )
}
