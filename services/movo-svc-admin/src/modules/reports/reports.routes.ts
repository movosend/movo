import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from "fastify";
import {
  ADMIN_REPORT_IDS,
  AdminReportById,
  AdminReportExportSection,
  AdminReportId,
  ApiError,
  DistanceBand,
  EXPORT_ROWS_HEADER,
  EXPORT_TRUNCATED_HEADER,
  PaymentReportFact,
  REPORT_RANGE_ERROR_MESSAGES,
  reportAppliesBand,
  ReportMeta,
  ReportRange,
  resolveReportRange,
  ShipmentReportFact,
} from "@movo/shared";
import { CSV_MAX_ROWS, csvFileName } from "../../utils/csv";
import { requireAdmin } from "../../utils/require-admin";
import { cashflowReport, pricingReport } from "./financial-reports";
import { disputeRowsCsv, reportSectionCsv } from "./report-csv";
import { reportsSchemas } from "./reports.schema";

interface ReportQuery {
  from?: string;
  to?: string;
  band?: DistanceBand;
}

interface RequestCtx {
  requestId: string;
}

export interface ReportsRoutesOptions extends FastifyPluginOptions {
  /** Override solo para tests: probar el corte sin armar `CSV_MAX_ROWS` filas. */
  exportMaxRows?: number;
}

const FILE_LABELS: Readonly<Record<AdminReportId, string>> = {
  cashflow: "cashflow",
  pricing: "precio",
  deliveries: "entregas",
  carriers: "transportistas",
  distances: "distancias",
  support: "soporte",
  disputes: "disputas",
};

const REPORT_DESCRIPTIONS: Readonly<Record<AdminReportId, string>> = {
  cashflow:
    "MOVO-35: por fecha en que el envío se completó, efectivo incluido. `commission` es la capturada o la devengada en efectivo, y `takeRate` la compara solo con el GMV de los envíos que la tienen. `pendingCapture` son capturas sin confirmar, aparte de `gmv`.",
  pricing:
    "MOVO-35: `bridge` explica el GMV de completados contra el período anterior. `leakage` va por fecha de publicación, así que no coincide con el GMV de Cashflow. Sin desglose guardado, el efecto precio cae en `other`.",
  deliveries:
    "MOVO-35: por fecha de entrega. `onTimeRate` y `lateCount` miden contra la franja estimada; un envío sin franja vence al terminar el día estimado, y uno sin fecha estimada no entra. `delayReason` se deriva con la regla de DD-059.",
  carriers:
    "MOVO-35: por fecha de publicación. `activeCarriers` es el promedio diario con viaje u oferta; con `band`, las ofertas a envíos de ese tramo y los viajes cuya ruta cae en él. Un transportista puede contar en más de un tramo, así que los tramos no suman el total.",
  distances: "MOVO-35: por fecha de publicación. `corridors` trae los 20 con más envíos; `scorecard` siempre trae los tres tramos e ignora `band`.",
  support: "MOVO-35: conversaciones abiertas en el rango. No se filtra por distancia (`meta.bandApplied` es `false`).",
  disputes:
    "MOVO-344: `opened` y `disputeRate` por fecha de apertura. `disputeRate` es disputas abiertas cada 100 envíos completados en el mismo período: no es una cohorte y puede pasar de 100. `resolved`, `resolutionHours` y los montos por fecha de resolución, solo con la disputa `resolved` (una `resolving` no cuenta). `backlog` es lo que sigue sin resolverse ahora y no depende del rango. `funnel` sigue a las disputas abiertas en el período hasta su estado actual.",
};

function rangeOf({ from, to }: ReportQuery): ReportRange {
  const resolved = resolveReportRange({ ...(from ? { from } : {}), ...(to ? { to } : {}) });
  if (!resolved.ok) {
    throw new ApiError(400, "REPORT_RANGE_INVALID", REPORT_RANGE_ERROR_MESSAGES[resolved.reason], { reason: resolved.reason });
  }
  return resolved.range;
}

/**
 * MOVO-344 y MOVO-35 (ADR-025): reportes de Métricas. Entregas, Transportistas, Distancias, Soporte y Disputas los calcula
 * `svc-shipments`. Cashflow y Precio cruzan envíos con cobros, que viven en servicios distintos, y se terminan de armar acá.
 */
export default async function reportsRoutes(app: FastifyInstance, opts: ReportsRoutesOptions) {
  const exportMaxRows = opts.exportMaxRows ?? CSV_MAX_ROWS;

  async function crossedFacts(range: ReportRange, band: DistanceBand | undefined, ctx: RequestCtx) {
    const { items } = await app.shipmentsClient.getShipmentReportFacts(range, ctx);
    const facts: ShipmentReportFact[] = band ? items.filter((fact) => fact.band === band) : items;
    const { items: payments } = await app.paymentsClient.getReportFacts(
      facts.map((fact) => fact.shipmentId),
      ctx,
    );
    return { facts, payments: new Map<string, PaymentReportFact>(payments.map((payment) => [payment.shipmentId, payment])) };
  }

  async function sourceOf<R extends AdminReportId>(id: R, range: ReportRange, band: DistanceBand | undefined, ctx: RequestCtx) {
    if (id === "cashflow" || id === "pricing") {
      const { facts, payments } = await crossedFacts(range, band, ctx);
      return id === "cashflow" ? cashflowReport(facts, payments, range, new Date()) : pricingReport(facts, payments, range, new Date());
    }
    if (id === "disputes") return app.shipmentsClient.getDisputesReport(range, ctx, band);
    return app.shipmentsClient.getOwnedReport(id, range, ctx, band);
  }

  async function reportOf<R extends AdminReportId>(id: R, range: ReportRange, requestedBand: DistanceBand | undefined, ctx: RequestCtx): Promise<AdminReportById[R]> {
    const applies = reportAppliesBand(id);
    const band = applies ? requestedBand : undefined;
    const source = await sourceOf(id, range, band, ctx);
    const meta: ReportMeta = { ...source.meta, band: band ?? null, bandApplied: applies };
    return { ...source, meta } as unknown as AdminReportById[R];
  }

  for (const id of ADMIN_REPORT_IDS) {
    app.get(
      `/reports/${id}`,
      {
        schema: {
          tags: ["admin"],
          summary: `Reporte de ${FILE_LABELS[id]}: KPIs, series temporales y desgloses`,
          description: `${REPORT_DESCRIPTIONS[id]} La granularidad la decide el backend según el largo del rango.`,
          querystring: reportsSchemas.reportQuery(id),
          response: {
            200: reportsSchemas.reportResponse(id),
            400: reportsSchemas.errorResponse,
            401: reportsSchemas.errorResponse,
            403: reportsSchemas.errorResponse,
          },
        },
      },
      async (request: FastifyRequest, reply: FastifyReply) => {
        requireAdmin(request);
        const query = request.query as ReportQuery;
        const report = await reportOf(id, rangeOf(query), query.band, { requestId: request.requestId });
        reply.header("cache-control", "no-store");
        return report;
      },
    );

    app.get(
      `/reports/${id}/export`,
      {
        schema: {
          tags: ["admin"],
          summary: `Reporte de ${FILE_LABELS[id]} en CSV, con los mismos filtros que el JSON`,
          description:
            `Las secciones salen del mismo cálculo que \`GET /admin/reports/${id}\`. ` +
            (id === "disputes"
              ? `\`disputes\` trae una fila por disputa abierta o resuelta en el rango (ids, fechas y montos, sin datos personales), con tope de ${CSV_MAX_ROWS} filas: ` +
                "es otra cohorte que los KPIs, que cuentan cada dato por su propia fecha, así que sus montos no tienen por qué sumar lo mismo. "
              : "") +
            "`X-Export-Rows` dice cuántas filas trae, sin contar la de `Total`, y `X-Export-Truncated` si se cortó. Cada exportación queda en la " +
            "bitácora (`report.export`, objetivo `report`).",
          querystring: reportsSchemas.exportQuery(id),
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
        const query = request.query as ReportQuery & { section: AdminReportExportSection };
        // Antes de la acción auditada: un rango inválido es un 400 de la query, sin fila en la bitácora.
        const range = rangeOf(query);
        const { section } = query;
        const ctx = { requestId: request.requestId };
        const { csv, truncated } = await app.audit.runAdminAction(
          {
            adminId,
            action: "report.export",
            target: { type: "report", id },
            context: { filters: query },
            requestId: request.requestId,
            resolveContext: (result) => ({ rows: result.csv.rows, truncated: result.truncated }),
          },
          async () => {
            if (section === "disputes") {
              const { items, truncated: cut } = await app.shipmentsClient.listDisputesReportRows(range, exportMaxRows, ctx, query.band);
              return { csv: disputeRowsCsv(items), truncated: cut };
            }
            return { csv: reportSectionCsv(id, await reportOf(id, range, query.band, ctx), section), truncated: false };
          },
        );
        return reply
          .header("content-type", "text/csv; charset=utf-8")
          .header("content-disposition", `attachment; filename="${csvFileName(`movo-${FILE_LABELS[id]}-${section.replace(".", "-")}`)}"`)
          .header("cache-control", "no-store")
          .header(EXPORT_ROWS_HEADER, String(csv.rows))
          .header(EXPORT_TRUNCATED_HEADER, String(truncated))
          .send(csv.body);
      },
    );
  }
}
