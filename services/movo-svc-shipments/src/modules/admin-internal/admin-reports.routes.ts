import { FastifyInstance, FastifyPluginOptions, FastifyRequest } from "fastify";
import { ApiError, REPORT_RANGE_ERROR_MESSAGES, ReportRange, validateReportRange } from "@movo/shared";
import { createAdminReportsRepository } from "../../repositories/admin-reports-repository";

const rangeProperties = { from: { type: "string" }, to: { type: "string" } } as const;

/** `svc-admin` ya completó y validó el rango; se revalida porque de acá sale el SQL. */
function rangeOf(query: ReportRange): ReportRange {
  const validated = validateReportRange(query);
  if (!validated.ok) {
    throw new ApiError(400, "REPORT_RANGE_INVALID", REPORT_RANGE_ERROR_MESSAGES[validated.reason], { reason: validated.reason });
  }
  return query;
}

/** MOVO-344 (ADR-025): agregados del reporte de disputas. Internos, los consume `svc-admin` (sin ruta en el gateway). */
export default async function adminReportsRoutes(app: FastifyInstance, _opts: FastifyPluginOptions) {
  const repository = createAdminReportsRepository(app.db);

  app.get(
    "/admin/reports/disputes",
    {
      schema: {
        hide: true,
        querystring: { type: "object", additionalProperties: false, required: ["from", "to"], properties: rangeProperties },
      },
    },
    async (request: FastifyRequest) => repository.disputes(rangeOf(request.query as ReportRange), new Date()),
  );

  app.get(
    "/admin/reports/disputes/rows",
    {
      schema: {
        hide: true,
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["from", "to", "limit"],
          properties: { ...rangeProperties, limit: { type: "integer", minimum: 1, maximum: 10_000 } },
        },
      },
    },
    async (request: FastifyRequest) => {
      const { limit, ...range } = request.query as ReportRange & { limit: number };
      return repository.disputeRows(rangeOf(range), limit);
    },
  );
}
