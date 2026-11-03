import { FastifyInstance, FastifyPluginOptions, FastifyRequest } from "fastify";
import {
  argentinaDayBounds,
  OverviewBreakdownRow,
  OverviewInboxSource,
  OverviewKycExtra,
  OverviewUserReportsExtra,
  toArgentinaCalendarDateString,
} from "@movo/shared";

const DAY_MS = 24 * 60 * 60 * 1000;

const isoOf = (date: Date | null | undefined): string | null => date?.toISOString() ?? null;

const reportedBody = {
  type: "object",
  additionalProperties: false,
  required: ["ids"],
  properties: { ids: { type: "array", maxItems: 100, items: { type: "string", format: "uuid" } } },
} as const;

/**
 * MOVO-342 (ADR-025, DD-058): bandejas de la home del panel que viven en este servicio y el reportado de un reporte para
 * la bitácora. Internas (no se declaran en el gateway), las consume `svc-admin`. El plazo lo agrega `svc-admin`.
 */
export default async function adminOverviewInternalRoutes(app: FastifyInstance, _opts: FastifyPluginOptions) {
  app.get("/admin/overview/kyc", { schema: { hide: true } }, async (): Promise<OverviewInboxSource<OverviewKycExtra>> => {
    const yesterday = new Date(Date.now() - DAY_MS);
    // El último intento de cada verificación de cada cuenta viva: un reintento reemplaza al anterior, así una sesión
    // abandonada no se cuenta dos veces. "Ayer" toma los que ya estaban pedidos y sin resolver a esa hora.
    const rows = await app.db.$queryRaw<Array<{ type: string; count: number; oldest: Date | null; yesterday: number }>>`
      WITH latest AS (
        SELECT DISTINCT ON (v.user_id, v.verification_type)
               v.verification_type::text AS type, v.status::text AS status, v.requested_at, v.resolved_at
        FROM users.kyc_verification v
        JOIN users.users u ON u.id = v.user_id
        WHERE u.deleted_at IS NULL
        ORDER BY v.user_id, v.verification_type, v.requested_at DESC
      )
      SELECT type,
             (COUNT(*) FILTER (WHERE status IN ('pending', 'manual_review')))::int AS count,
             MIN(requested_at) FILTER (WHERE status IN ('pending', 'manual_review')) AS oldest,
             (COUNT(*) FILTER (WHERE requested_at <= ${yesterday} AND (resolved_at IS NULL OR resolved_at > ${yesterday})))::int AS yesterday
      FROM latest
      GROUP BY type`;
    const oldest = rows.reduce<Date | null>((min, row) => (row.oldest && (!min || row.oldest < min) ? row.oldest : min), null);
    const countOf = (type: string) => rows.find((row) => row.type === type)?.count ?? 0;
    return {
      count: rows.reduce((sum, row) => sum + row.count, 0),
      // La licencia solo la pide quien va a transportar; la identidad, todos.
      carriers: countOf("license"),
      senders: countOf("identity"),
      oldestAt: isoOf(oldest),
      yesterdayCount: rows.reduce((sum, row) => sum + row.yesterday, 0),
      breakdown: rows
        .filter((row) => row.count > 0)
        .map((row): OverviewBreakdownRow => ({ key: row.type, count: row.count }))
        .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
    };
  });

  app.get("/admin/overview/user-reports", { schema: { hide: true } }, async (): Promise<OverviewInboxSource<OverviewUserReportsExtra>> => {
    // Sin "ayer": `UserReport` no guarda cuándo se revisó. `blockRequested`: quien reportó además bloqueó al reportado.
    const [totals, breakdown] = await Promise.all([
      app.db.$queryRaw<Array<{ count: number; blocked: number; oldest: Date | null }>>`
        SELECT COUNT(*)::int AS count,
               (COUNT(*) FILTER (WHERE EXISTS (
                 SELECT 1 FROM users.user_blocks b WHERE b.blocker_id = r.reporter_id AND b.blocked_id = r.reported_id
               )))::int AS blocked,
               MIN(r.created_at) AS oldest
        FROM users.user_reports r
        WHERE r.status::text = 'pending'`,
      app.db.$queryRaw<Array<{ key: string; count: number }>>`
        SELECT r.reason::text AS key, COUNT(*)::int AS count
        FROM users.user_reports r
        WHERE r.status::text = 'pending'
        GROUP BY r.reason
        ORDER BY count DESC, key ASC`,
    ]);
    const row = totals[0];
    return {
      count: row?.count ?? 0,
      blockRequested: row?.blocked ?? 0,
      oldestAt: isoOf(row?.oldest),
      yesterdayCount: null,
      breakdown: breakdown.map((entry) => ({ key: entry.key, count: entry.count })),
    };
  });

  app.get("/admin/overview/sanctions-ending-today", { schema: { hide: true } }, async (): Promise<OverviewInboxSource> => {
    const now = new Date();
    const today = argentinaDayBounds(toArgentinaCalendarDateString(now));
    const yesterday = new Date(now.getTime() - DAY_MS);
    const yesterdayDay = argentinaDayBounds(toArgentinaCalendarDateString(yesterday));
    // "Ayer": las que vencían ese día, ya aplicadas y sin levantar a esta misma hora.
    const [rows, previous] = await Promise.all([
      app.db.$queryRaw<Array<{ key: string; count: number; oldest: Date | null }>>`
        SELECT s.type::text AS key, COUNT(*)::int AS count, MIN(s.ends_at) AS oldest
        FROM users.account_sanctions s
        WHERE s.ends_at >= ${today.start} AND s.ends_at < ${today.end} AND s.lifted_at IS NULL
        GROUP BY s.type
        ORDER BY count DESC, key ASC`,
      app.db.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*)::int AS count
        FROM users.account_sanctions s
        WHERE s.ends_at >= ${yesterdayDay.start} AND s.ends_at < ${yesterdayDay.end}
          AND s.started_at <= ${yesterday} AND (s.lifted_at IS NULL OR s.lifted_at > ${yesterday})`,
    ]);
    const oldest = rows.reduce<Date | null>((min, row) => (row.oldest && (!min || row.oldest < min) ? row.oldest : min), null);
    return {
      count: rows.reduce((sum, row) => sum + row.count, 0),
      oldestAt: isoOf(oldest),
      yesterdayCount: previous[0]?.count ?? 0,
      breakdown: rows.map((row) => ({ key: row.key, count: row.count })),
    };
  });

  // La bitácora linkea un reporte de usuario a la ficha de la persona reportada. Un id inexistente no vuelve.
  app.post("/admin/user-reports/reported", { schema: { hide: true, body: reportedBody } }, async (request: FastifyRequest) => {
    const { ids } = request.body as { ids: string[] };
    const rows = await app.db.userReport.findMany({ where: { id: { in: ids } }, select: { id: true, reportedId: true } });
    return { reports: rows };
  });
}
