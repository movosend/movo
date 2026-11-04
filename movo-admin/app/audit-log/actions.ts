"use server"
import type { AdminAuditLogPage } from "@movo/shared/src/types/admin-reports"
import { ApiError } from "@movo/shared/src/errors/api-error"
import { requireAdmin } from "@/lib/auth/session"
import { getAuditLog } from "@/lib/reports/api"
import { auditHref, parseAuditState } from "@/lib/reports/params"

export type AuditPageResult =
  { ok: true; data: AdminAuditLogPage } | { ok: false; status: number }

/** "Cargar 20 más": la página siguiente del mismo filtro (el filtro viaja como la query de la URL). */
export async function loadAuditPage(
  query: string,
  cursor: string
): Promise<AuditPageResult> {
  const state = parseAuditState(Object.fromEntries(new URLSearchParams(query)))
  await requireAdmin(false, auditHref(state))
  try {
    return { ok: true, data: await getAuditLog(state, cursor) }
  } catch (error) {
    return {
      ok: false,
      status: error instanceof ApiError ? error.statusCode : 503,
    }
  }
}
