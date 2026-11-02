import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from "fastify";
import {
  ApiError,
  DisputesReport,
  DisputesReportExportSection,
  EXPORT_ROWS_HEADER,
  EXPORT_TRUNCATED_HEADER,
  REPORT_RANGE_ERROR_MESSAGES,
  ReportRange,
  resolveReportRange,
} from "@movo/shared";
import { CSV_MAX_ROWS, csvFileName } from "../../utils/csv";
import { requireAdmin } from "../../utils/require-admin";
import { disputeRowsCsv, disputesReportSectionCsv } from "./disputes-report-csv";
import { reportsSchemas } from "./reports.schema";

interface DisputesQuery {
  from?: string;
  to?: string;
  band?: string;
}

export interface ReportsRoutesOptions extends FastifyPluginOptions {
  /** Override solo para tests: probar el corte sin armar `CSV_MAX_ROWS` filas. */
  exportMaxRows?: number;
}

function rangeOf({ from, to }: DisputesQuery): ReportRange {
  const resolved = resolveReportRange({ ...(from ? { from } : {}), ...(to ? { to } : {}) });
  if (!resolved.ok) {
    throw new ApiError(400, "REPORT_RANGE_INVALID", REPORT_RANGE_ERROR_MESSAGES[resolved.reason], { reason: resolved.reason });
  }
  return resolved.range;
}

/**
 * MOVO-344 (ADR-025): reporte de disputas. Los agregados los calcula `svc-shipments`; acá se valida el rango y se arma
 * el CSV. El filtro de distancia se acepta y no se aplica mientras el envío no tenga una distancia persistida.
 */
export default async function reportsRoutes(app: FastifyInstance, opts: ReportsRoutesOptions) {
  const exportMaxRows = opts.exportMaxRows ?? CSV_MAX_ROWS;

  async function disputesReport(range: ReportRange, ctx: { requestId: string }): Promise<DisputesReport> {
    const source = await app.shipmentsClient.getDisputesReport(range, ctx);
    return { ...source, meta: { ...source.meta, band: null, bandApplied: false } };
  }

  app.get(
    "/reports/disputes",
    {
      schema: {
        tags: ["admin"],
        summary: "Reporte de disputas: KPIs, series temporales y desgloses",
        description:
          "MOVO-344: `opened` y `disputeRate` por fecha de apertura; `resolved`, `resolutionHours` y los montos por fecha de resolución, solo " +
          "con la disputa `resolved` (una `resolving` no cuenta). `backlog` es lo que sigue sin resolverse ahora y no depende del rango. " +
          "`funnel` sigue a las disputas abiertas en el período hasta su estado actual. " +
          "La granularidad la decide el backend según el largo del rango.",
        querystring: reportsSchemas.disputesQuery,
        response: {
          200: reportsSchemas.disputesResponse,
          400: reportsSchemas.errorResponse,
          401: reportsSchemas.errorResponse,
          403: reportsSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply): Promise<DisputesReport> => {
      requireAdmin(request);
      const report = await disputesReport(rangeOf(request.query as DisputesQuery), { requestId: request.requestId });
      reply.header("cache-control", "no-store");
      return report;
    },
  );

  app.get(
    "/reports/disputes/export",
    {
      schema: {
        tags: ["admin"],
        summary: "Reporte de disputas en CSV, con los mismos filtros que el JSON",
        description:
          "MOVO-344: `trend.<kpi>`, `breakdown.<dimension>` y `backlog` salen del mismo cálculo que `GET /admin/reports/disputes`; `disputes` trae " +
          `una fila por disputa abierta o resuelta en el rango (ids, fechas y montos, sin datos personales), con tope de ${CSV_MAX_ROWS} filas: ` +
          "es otra cohorte que los KPIs, que cuentan cada dato por su propia fecha, así que sus montos no tienen por qué sumar lo mismo. " +
          "`X-Export-Rows` dice cuántas filas trae, sin contar la de `Total`, y `X-Export-Truncated` si se cortó. Cada exportación queda en la " +
          "bitácora (`report.export`, objetivo `report`).",
        querystring: reportsSchemas.disputesExportQuery,
        produces: ["text/csv"],
        response: {
          200: reportsSchemas.exportResponse,
          400: reportsSchemas.errorResponse,
          401: reportsSchemas.errorResponse,
          403: reportsSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const adminId = requireAdmin(request);
      const query = request.query as DisputesQuery & { section: DisputesReportExportSection };
      const range = rangeOf(query);
      const { section } = query;
      const ctx = { requestId: request.requestId };
      const { csv, truncated } = await app.audit.runAdminAction(
        {
          adminId,
          action: "report.export",
          target: { type: "report", id: "disputes" },
          context: { filters: query },
          requestId: request.requestId,
          resolveContext: (result) => ({ rows: result.csv.rows, truncated: result.truncated }),
        },
        async () => {
          if (section === "disputes") {
            const { items, truncated: cut } = await app.shipmentsClient.listDisputesReportRows(range, exportMaxRows, ctx);
            return { csv: disputeRowsCsv(items), truncated: cut };
          }
          return { csv: disputesReportSectionCsv(await disputesReport(range, ctx), section), truncated: false };
        },
      );
      return reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", `attachment; filename="${csvFileName(`movo-disputas-${section.replace(".", "-")}`)}"`)
        .header("cache-control", "no-store")
        .header(EXPORT_ROWS_HEADER, String(csv.rows))
        .header(EXPORT_TRUNCATED_HEADER, String(truncated))
        .send(csv.body);
    },
  );
}
