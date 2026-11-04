import "server-only"
import { NextResponse } from "next/server"
import { ApiError } from "@movo/shared/src/errors/api-error"
import {
  EXPORT_ROWS_HEADER,
  EXPORT_TRUNCATED_HEADER,
} from "@movo/shared/src/types/admin-reports"
import { noStore } from "@/lib/support/session-api"
import type { ExportFile } from "./api"

/** El CSV hacia el navegador, con los mismos headers que manda `svc-admin`. */
export function csvResponse(file: ExportFile): NextResponse {
  const safeName = file.filename.replace(/[^A-Za-z0-9._-]/g, "_")
  return new NextResponse(file.csv, {
    headers: {
      ...noStore,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeName}"`,
      ...(file.rows != null ? { [EXPORT_ROWS_HEADER]: String(file.rows) } : {}),
      [EXPORT_TRUNCATED_HEADER]: String(file.truncated),
    },
  })
}

/** Un error del export: el código viaja para que el botón diga qué pasó, nunca el texto del servidor. */
export function exportError(error: unknown): NextResponse {
  const status = error instanceof ApiError ? error.statusCode : 502
  const code = error instanceof ApiError ? error.code : "EXPORT_FAILED"
  return NextResponse.json(
    { error: code },
    { status: status >= 400 ? status : 502, headers: noStore }
  )
}
