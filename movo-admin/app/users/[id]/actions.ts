"use server"
import { ApiError } from "@movo/shared/src/errors/api-error"
import type {
  AdminShipmentRole,
  AdminUserAuditPage,
  AdminUserLedger,
  AdminUserRatings,
  AdminUserShipmentPage,
  AdminUserTripPage,
} from "@movo/shared/src/types/admin-users"
import { assertOrigin, requireAdmin } from "@/lib/auth/session"
import { loadSection, type Loaded } from "@/lib/users/load"

const ACTIVITY_PAGE_SIZE = 5

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ROLES: readonly string[] = ["sender", "carrier", "receiver"]

export type ActivityTab = AdminShipmentRole | "trips"

/** Valida sesión, origen y parámetros; devuelve el error como dato para que la sección lo muestre. */
async function guard(
  userId: string,
  page: number
): Promise<{ ok: false; status: number } | null> {
  await assertOrigin()
  if (!UUID.test(userId) || !Number.isInteger(page) || page < 1 || page > 1000)
    return { ok: false, status: 400 }
  try {
    await requireAdmin(true)
  } catch (error) {
    if (error instanceof ApiError)
      return { ok: false, status: error.statusCode }
    throw error
  }
  return null
}

/** Cambio de pestaña o de página en Actividad: pide solo esa página, sin recargar la ficha. */
export async function loadActivityPage(
  userId: string,
  tab: ActivityTab,
  page: number
): Promise<Loaded<AdminUserShipmentPage | AdminUserTripPage>> {
  const denied = await guard(userId, page)
  if (denied) return denied
  if (tab === "trips")
    return loadSection(userId, "trips", { page, pageSize: ACTIVITY_PAGE_SIZE })
  if (!ROLES.includes(tab)) return { ok: false, status: 400 }
  return loadSection(userId, "shipments", {
    role: tab,
    page,
    pageSize: ACTIVITY_PAGE_SIZE,
  })
}

export async function loadRatingsPage(
  userId: string,
  page: number
): Promise<Loaded<AdminUserRatings>> {
  const denied = await guard(userId, page)
  if (denied) return denied
  return loadSection(userId, "ratings", { page, pageSize: ACTIVITY_PAGE_SIZE })
}

const CURSOR = /^[A-Za-z0-9_=.-]{1,200}$/

/** "Ver más" de la cuenta corriente: la página siguiente a `cursor`, que viene de la respuesta anterior. */
export async function loadLedgerMore(
  userId: string,
  cursor: string
): Promise<Loaded<AdminUserLedger>> {
  const denied = await guard(userId, 1)
  if (denied) return denied
  if (!CURSOR.test(cursor)) return { ok: false, status: 400 }
  return loadSection(userId, "ledger", { cursor, limit: 20 })
}

export async function loadAuditMore(
  userId: string,
  cursor: string
): Promise<Loaded<AdminUserAuditPage>> {
  const denied = await guard(userId, 1)
  if (denied) return denied
  if (!CURSOR.test(cursor)) return { ok: false, status: 400 }
  return loadSection(userId, "audit", { cursor, limit: 20 })
}
