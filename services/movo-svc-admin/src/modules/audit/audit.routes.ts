import { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from "fastify";
import {
  AdminAuditLogPage,
  AdminTargetType,
  ApiError,
  argentinaDayBounds,
  AUDIT_TARGET_PREFIX_MIN_LENGTH,
  AuditLogEntry,
  EXPORT_ROWS_HEADER,
  EXPORT_TRUNCATED_HEADER,
  REPORT_RANGE_ERROR_MESSAGES,
  validateReportRange,
} from "@movo/shared";
import { requireAdmin } from "../../utils/require-admin";
import { CSV_MAX_ROWS, CsvColumn, csvFileName, toCsv } from "../../utils/csv";
import { AuditLogFilters } from "./audit.repository";
import { resolveAuditAdmins, resolveAuditRefs } from "./audit-refs";
import { auditSchemas } from "./audit.schema";

interface AuditLogFilterQuery {
  adminId?: string;
  action?: string;
  targetType?: AdminTargetType;
  targetId?: string;
  from?: string;
  to?: string;
}

interface AuditLogQuery extends AuditLogFilterQuery {
  limit: number;
  cursor?: string;
}

export interface AuditRoutesOptions extends FastifyPluginOptions {
  /** Override solo para tests: probar el corte sin insertar `CSV_MAX_ROWS` filas. */
  exportMaxRows?: number;
}

/**
 * Mismos filtros para el listado y el CSV. El rango son días de Argentina (400 `REPORT_RANGE_INVALID`). Desde
 * `AUDIT_TARGET_PREFIX_MIN_LENGTH` caracteres, `targetId` también matchea por prefijo: el panel muestra ids cortos.
 */
function filtersOf(query: AuditLogFilterQuery): AuditLogFilters {
  const { from, to, targetId, ...rest } = query;
  const validated = validateReportRange({ ...(from ? { from } : {}), ...(to ? { to } : {}) });
  if (!validated.ok) {
    throw new ApiError(400, "REPORT_RANGE_INVALID", REPORT_RANGE_ERROR_MESSAGES[validated.reason], { reason: validated.reason });
  }
  const { from: fromDay, to: toDay } = validated.range;
  return {
    ...rest,
    ...(targetId ? (targetId.length >= AUDIT_TARGET_PREFIX_MIN_LENGTH ? { targetIdPrefix: targetId } : { targetId }) : {}),
    ...(fromDay ? { from: argentinaDayBounds(fromDay).start } : {}),
    ...(toDay ? { to: argentinaDayBounds(toDay).end } : {}),
  };
}

/** Columnas que acordó el panel (MOVO-345). Sin `context`: puede traer datos que no hace falta sacar del sistema. */
const csvColumns = (admins: Record<string, { fullName: string }>): readonly CsvColumn<AuditLogEntry>[] => [
  { header: "created_at", value: (row) => row.createdAt },
  { header: "admin_id", value: (row) => row.adminId },
  { header: "admin_name", value: (row) => admins[row.adminId]?.fullName },
  { header: "action", value: (row) => row.action },
  { header: "target_type", value: (row) => row.targetType },
  { header: "target_id", value: (row) => row.targetId },
  { header: "outcome", value: (row) => row.outcome },
  { header: "error_code", value: (row) => row.errorCode },
  { header: "reason", value: (row) => row.reason },
  { header: "request_id", value: (row) => row.requestId },
];

/** MOVO-288 AC7: lectura de la bitácora. La lee cualquier admin; no es una escritura. */
export default async function auditRoutes(app: FastifyInstance, opts: AuditRoutesOptions) {
  const refsDeps = { usersClient: app.usersClient, shipmentsClient: app.shipmentsClient, logger: app.log };
  const exportMaxRows = opts.exportMaxRows ?? CSV_MAX_ROWS;

  app.get(
    "/audit-log",
    {
      schema: {
        tags: ["admin"],
        summary: "Bitácora de acciones del panel, de la más reciente a la más vieja",
        description:
          "`admins` (id → nombre) y `targets` (`auditTargetKey(tipo, id)` → etiqueta y relación) son best-effort: si un servicio no " +
          "responde faltan esas claves y el panel muestra el id corto. `from`/`to`: días de Argentina, inclusivos.",
        querystring: auditSchemas.listQuery,
        response: {
          200: auditSchemas.listResponse,
          400: auditSchemas.errorResponse,
          401: auditSchemas.errorResponse,
          403: auditSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest): Promise<AdminAuditLogPage> => {
      requireAdmin(request);
      const { limit, cursor, ...query } = request.query as AuditLogQuery;
      const page = await app.audit.list(filtersOf(query), limit, cursor);
      return { ...page, ...(await resolveAuditRefs(page.items, refsDeps, { requestId: request.requestId })) };
    },
  );

  app.get(
    "/audit-log/export",
    {
      schema: {
        tags: ["admin"],
        summary: "Bitácora en CSV, con los mismos filtros que el listado",
        description:
          "MOVO-342: mismas filas y mismo orden que `GET /admin/audit-log` con los mismos filtros, sin paginar. Celdas escapadas contra " +
          `inyección de fórmulas. Tope de ${CSV_MAX_ROWS} filas: \`X-Export-Rows\` dice cuántas trae y \`X-Export-Truncated\` si se cortó. ` +
          "Cada exportación deja su propia fila en la bitácora (`report.export`, objetivo `report`), que no entra en el CSV que la generó.",
        querystring: auditSchemas.exportQuery,
        produces: ["text/csv"],
        response: {
          200: auditSchemas.exportResponse,
          400: auditSchemas.errorResponse,
          401: auditSchemas.errorResponse,
          403: auditSchemas.errorResponse,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const adminId = requireAdmin(request);
      const query = request.query as AuditLogFilterQuery;
      const filters = filtersOf(query);
      const ctx = { requestId: request.requestId };
      // Por `runAdminAction` aunque es una lectura, para que quede quién sacó qué datos y cuándo: el CSV lleva ids y motivos.
      const { rows, truncated } = await app.audit.runAdminAction(
        {
          adminId,
          action: "report.export",
          target: { type: "report", id: "audit_log" },
          context: { filters: query },
          requestId: request.requestId,
          resolveContext: (result) => ({ rows: result.rows.length, truncated: result.truncated }),
        },
        () => app.audit.listForExport(filters, exportMaxRows),
      );
      const admins = await resolveAuditAdmins(rows, refsDeps, ctx);
      return reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", `attachment; filename="${csvFileName("movo-bitacora")}"`)
        .header("cache-control", "no-store")
        .header(EXPORT_ROWS_HEADER, String(rows.length))
        .header(EXPORT_TRUNCATED_HEADER, String(truncated))
        .send(toCsv(csvColumns(admins), rows));
    },
  );
}
