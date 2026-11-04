import { NextRequest, NextResponse } from "next/server"
import {
  ADMIN_REPORT_IDS,
  DISTANCE_BANDS,
  REPORT_RANGE_MAX_DAYS,
  type AdminReportId,
  type DistanceBand,
} from "@movo/shared/src/types/admin-reports"
import { exportReport } from "@/lib/reports/api"
import { csvResponse, exportError } from "@/lib/reports/export-response"
import { isDay, rangeLength } from "@/lib/reports/range"
import { adminForApi, noStore } from "@/lib/support/session-api"

const SECTION =
  /^(trend|breakdown)\.[A-Za-z]+$|^(scorecard|corridors|bridge|leakage)$/

/** CSV de una sección de Métricas (`?from=&to=&band=&section=`), generado por `svc-admin`. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ report: string }> }
) {
  const session = await adminForApi(request)
  if (session instanceof NextResponse) return session
  const { report } = await params
  const q = request.nextUrl.searchParams
  const from = q.get("from")
  const to = q.get("to")
  const band = q.get("band")
  const section = q.get("section") ?? ""
  // Métricas en modo demostración: el CSV trae los mismos números ficticios que se ven.
  const demo = q.get("datos") === "demo"
  const valid =
    ADMIN_REPORT_IDS.includes(report as AdminReportId) &&
    isDay(from) &&
    isDay(to) &&
    from <= to &&
    rangeLength({ from, to }) <= REPORT_RANGE_MAX_DAYS &&
    (!band || DISTANCE_BANDS.includes(band as DistanceBand)) &&
    SECTION.test(section)
  if (!valid)
    return NextResponse.json(
      { error: "VALIDATION_ERROR" },
      { status: 400, headers: noStore }
    )
  try {
    const file = await exportReport(
      report as AdminReportId,
      { from, to, ...(band ? { band: band as DistanceBand } : {}) },
      section,
      { demo }
    )
    return csvResponse(file)
  } catch (error) {
    return exportError(error)
  }
}
