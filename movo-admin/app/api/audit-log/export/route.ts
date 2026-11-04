import { NextRequest, NextResponse } from "next/server"
import { exportAuditLog } from "@/lib/reports/api"
import { csvResponse, exportError } from "@/lib/reports/export-response"
import { parseAuditState } from "@/lib/reports/params"
import { adminForApi } from "@/lib/support/session-api"

/** CSV de la bitácora con los filtros de la URL de la pantalla (`?admin=&action=&target=&q=`). */
export async function GET(request: NextRequest) {
  const session = await adminForApi(request)
  if (session instanceof NextResponse) return session
  const state = parseAuditState(
    Object.fromEntries(request.nextUrl.searchParams)
  )
  try {
    return csvResponse(await exportAuditLog(state))
  } catch (error) {
    return exportError(error)
  }
}
