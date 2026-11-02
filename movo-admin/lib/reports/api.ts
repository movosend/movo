import "server-only"
import { cookies } from "next/headers"
import type { AuditLogPage } from "@movo/shared/src/types/admin"
import type { AdminSummary } from "@movo/shared/src/types/user"
import {
  ADMIN_OVERVIEW_BLOCKS,
  EXPORT_ROWS_HEADER,
  EXPORT_TRUNCATED_HEADER,
  type AdminAuditLogPage,
  type AdminOverview,
  type AdminOverviewBlockId,
  type AdminReportById,
  type AdminReportId,
  type AdminReportQuery,
} from "@movo/shared/src/types/admin-reports"
import { gateway, gatewayFile } from "@/lib/auth/api"
import { ACCESS_COOKIE } from "@/lib/auth/policy"
import { MOCK_ADMINS } from "./fixtures"
import {
  demoExportReport,
  demoReport,
  mockAuditLog,
  mockEnabled,
  mockExportAuditLog,
  mockExportReport,
  mockGetOverview,
  mockGetReport,
} from "./mock"
import { auditGatewayQuery, type AuditState } from "./params"

export const AUDIT_PAGE_SIZE = 20

const token = async () => (await cookies()).get(ACCESS_COOKIE)?.value

/** Un CSV listo para bajar: el nombre sale del `Content-Disposition` del backend. */
export interface ExportFile {
  csv: string
  filename: string
  rows: number | null
  truncated: boolean
}

function fileFrom(
  body: string,
  headers: Headers,
  fallback: string
): ExportFile {
  const disposition = headers.get("content-disposition") ?? ""
  const filename = /filename="?([^";]+)"?/i.exec(disposition)?.[1] ?? fallback
  const rows = Number(headers.get(EXPORT_ROWS_HEADER))
  return {
    csv: body,
    filename,
    rows:
      Number.isFinite(rows) && headers.has(EXPORT_ROWS_HEADER) ? rows : null,
    truncated: headers.get(EXPORT_TRUNCATED_HEADER) === "true",
  }
}

const reportQuery = (query: AdminReportQuery, section?: string) => {
  const q = new URLSearchParams({ from: query.from, to: query.to })
  if (query.band) q.set("band", query.band)
  if (section) q.set("section", section)
  return q.toString()
}

// ---------------------------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------------------------

/**
 * `GET /admin/overview` (MOVO-342). Un bloque que el backend no mandó (versión anterior) se completa
 * como error de ese bloque: la home nunca se cae entera por una tarjeta.
 */
export async function getOverview(
  blocks?: AdminOverviewBlockId[]
): Promise<AdminOverview> {
  const wanted = blocks?.length ? blocks : ADMIN_OVERVIEW_BLOCKS
  const raw = mockEnabled()
    ? await mockGetOverview(blocks)
    : await gateway<AdminOverview>(
        `/admin/overview${blocks?.length ? `?${new URLSearchParams({ blocks: blocks.join(",") })}` : ""}`,
        { accessToken: await token() }
      )
  const out: Record<string, unknown> = {}
  for (const id of wanted) {
    out[id] = raw.blocks?.[id] ?? {
      data: null,
      error: {
        code: "BLOCK_UNAVAILABLE",
        message: "El servicio todavía no devuelve esta bandeja.",
      },
    }
  }
  return {
    generatedAt: raw.generatedAt ?? new Date().toISOString(),
    blocks: out as AdminOverview["blocks"],
  }
}

// ---------------------------------------------------------------------------------------------
// Métricas
// ---------------------------------------------------------------------------------------------

/** `GET /admin/reports/:report` (MOVO-344). Con `demo`, datos de demostración generados acá. */
export async function getReport<R extends AdminReportId>(
  id: R,
  query: AdminReportQuery,
  { demo = false }: { demo?: boolean } = {}
): Promise<AdminReportById[R]> {
  if (demo) return demoReport(id, query)
  if (mockEnabled()) return mockGetReport(id, query)
  return gateway<AdminReportById[R]>(
    `/admin/reports/${id}?${reportQuery(query)}`,
    { accessToken: await token() }
  )
}

/** `GET /admin/reports/:report/export?section=`: el CSV de una sección, generado en el backend. */
export async function exportReport(
  id: AdminReportId,
  query: AdminReportQuery,
  section: string,
  { demo = false }: { demo?: boolean } = {}
): Promise<ExportFile> {
  if (demo) return demoExportReport(id, query, section)
  if (mockEnabled()) return mockExportReport(id, query, section)
  const { body, headers } = await gatewayFile(
    `/admin/reports/${id}/export?${reportQuery(query, section)}`,
    {
      accessToken: await token(),
    }
  )
  return fileFrom(
    body,
    headers,
    `movo-${id}-${section.replace(".", "-")}_${query.from}_${query.to}.csv`
  )
}

// ---------------------------------------------------------------------------------------------
// Bitácora
// ---------------------------------------------------------------------------------------------

/**
 * `GET /admin/audit-log` (MOVO-288, ampliado por MOVO-342 con `admins` y `targets`). Contra un
 * `svc-admin` que todavía no los manda, los mapas quedan vacíos y el panel muestra los ids.
 */
export async function getAuditLog(
  state: AuditState,
  cursor: string | null = null
): Promise<AdminAuditLogPage> {
  const query = auditGatewayQuery(state, { cursor, limit: AUDIT_PAGE_SIZE })
  const page = mockEnabled()
    ? await mockAuditLog(new URLSearchParams(query))
    : await gateway<AuditLogPage & Partial<AdminAuditLogPage>>(
        `/admin/audit-log?${query}`,
        {
          accessToken: await token(),
        }
      )
  return {
    items: page.items,
    nextCursor: page.nextCursor,
    admins: page.admins ?? {},
    targets: page.targets ?? {},
  }
}

/** `GET /admin/audit-log/export`: todas las filas del filtro (con el tope del backend), no solo las cargadas. */
export async function exportAuditLog(state: AuditState): Promise<ExportFile> {
  const query = auditGatewayQuery(state)
  if (mockEnabled()) return mockExportAuditLog(new URLSearchParams(query))
  const { body, headers } = await gatewayFile(
    `/admin/audit-log/export${query ? `?${query}` : ""}`,
    {
      accessToken: await token(),
    }
  )
  return fileFrom(body, headers, "movo-bitacora.csv")
}

/**
 * Opciones del filtro "Admin": los admins de hoy (`GET /admin/admins`) más los que aparecen en la
 * página (un admin dado de baja ya no está en el listado, pero sus filas sí). Si el listado falla,
 * quedan solo los de la página.
 */
export async function listAuditAdmins(
  page: AdminAuditLogPage
): Promise<{ id: string; fullName: string }[]> {
  let current: { id: string; fullName: string }[] = []
  try {
    current = mockEnabled()
      ? MOCK_ADMINS.map(([id, fullName]) => ({ id, fullName }))
      : (
          await gateway<AdminSummary[]>("/admin/admins", {
            accessToken: await token(),
          })
        ).map(({ id, fullName }) => ({ id, fullName }))
  } catch {
    current = []
  }
  const byId = new Map(current.map((a) => [a.id, a]))
  for (const [id, { fullName }] of Object.entries(page.admins))
    if (!byId.has(id)) byId.set(id, { id, fullName })
  return [...byId.values()].sort((a, b) =>
    a.fullName.localeCompare(b.fullName, "es")
  )
}
