import { FastifyInstance, FastifyPluginOptions, FastifyRequest } from "fastify";
import { ApiError, CSV_MAX_ROWS, DISTANCE_BANDS, DistanceBand, REPORT_RANGE_ERROR_MESSAGES, ReportRange, validateReportRange } from "@movo/shared";
import { carriersReport, deliveriesReport, distancesReport, ShipmentMetricFact, supportReport } from "../../domain/admin-report-metrics";
import { createAdminReportsRepository } from "../../repositories/admin-reports-repository";

const rangeProperties = { from: { type: "string" }, to: { type: "string" } } as const;
const reportProperties = { ...rangeProperties, band: { type: "string", enum: [...DISTANCE_BANDS] } } as const;
const reportQuery = { type: "object", additionalProperties: false, required: ["from", "to"], properties: reportProperties } as const;
const SUPPORT_TOPICS = ["shipment", "payments", "account", "carrier", "security"] as const;

type ReportQuery = ReportRange & { band?: DistanceBand };

/** `svc-admin` ya completó y validó el rango; se revalida porque de acá sale el SQL. */
function rangeOf({ from, to }: ReportRange): ReportRange {
  const range = { from, to };
  const validated = validateReportRange(range);
  if (!validated.ok) {
    throw new ApiError(400, "REPORT_RANGE_INVALID", REPORT_RANGE_ERROR_MESSAGES[validated.reason], { reason: validated.reason });
  }
  return range;
}

/** MOVO-344 y MOVO-35 (ADR-025): agregados de los reportes del panel. Internos, los consume `svc-admin` (sin ruta en el gateway). */
export default async function adminReportsRoutes(app: FastifyInstance, _opts: FastifyPluginOptions) {
  const repository = createAdminReportsRepository(app.db);
  const inBand = (facts: ShipmentMetricFact[], band?: DistanceBand) => (band ? facts.filter((fact) => fact.band === band) : facts);

  app.get("/admin/reports/disputes", { schema: { hide: true, querystring: reportQuery } }, async (request: FastifyRequest) => {
    const query = request.query as ReportQuery;
    return repository.disputes(rangeOf(query), new Date(), query.band);
  });

  app.get(
    "/admin/reports/disputes/rows",
    {
      schema: {
        hide: true,
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["from", "to", "limit"],
          properties: { ...reportProperties, limit: { type: "integer", minimum: 1, maximum: CSV_MAX_ROWS } },
        },
      },
    },
    async (request: FastifyRequest) => {
      const query = request.query as ReportQuery & { limit: number };
      return repository.disputeRows(rangeOf(query), query.limit, query.band);
    },
  );

  app.get("/admin/reports/deliveries", { schema: { hide: true, querystring: reportQuery } }, async (request: FastifyRequest) => {
    const query = request.query as ReportQuery;
    const range = rangeOf(query);
    return deliveriesReport(inBand(await repository.shipmentMetricFacts(range), query.band), range, new Date());
  });

  app.get("/admin/reports/carriers", { schema: { hide: true, querystring: reportQuery } }, async (request: FastifyRequest) => {
    const query = request.query as ReportQuery;
    const range = rangeOf(query);
    const [facts, activity] = await Promise.all([repository.shipmentMetricFacts(range), repository.carrierActivity(range, query.band)]);
    return carriersReport(inBand(facts, query.band), activity, range, new Date());
  });

  app.get("/admin/reports/distances", { schema: { hide: true, querystring: reportQuery } }, async (request: FastifyRequest) => {
    const query = request.query as ReportQuery;
    const range = rangeOf(query);
    const facts = await repository.shipmentMetricFacts(range);
    return distancesReport(inBand(facts, query.band), facts, range, new Date());
  });

  app.get(
    "/admin/reports/support",
    { schema: { hide: true, querystring: { type: "object", additionalProperties: false, required: ["from", "to"], properties: rangeProperties } } },
    async (request: FastifyRequest) => {
      const range = rangeOf(request.query as ReportRange);
      return supportReport(await repository.supportMetricFacts(range), SUPPORT_TOPICS, range, new Date());
    },
  );

  app.get(
    "/admin/reports/shipment-facts",
    { schema: { hide: true, querystring: { type: "object", additionalProperties: false, required: ["from", "to"], properties: rangeProperties } } },
    async (request: FastifyRequest) => ({ items: await repository.shipmentReportFacts(rangeOf(request.query as ReportRange)) }),
  );
}
