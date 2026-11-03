import {
  AuditTargetsRequest,
  AuditTargetsResponse,
  formatSupportCode,
  OverviewBreakdownRow,
  OVERVIEW_FLAGGED_MESSAGES_WINDOW_DAYS,
  OverviewDisputesExtra,
  OverviewInboxSource,
  OverviewShipmentAlertsExtra,
  OverviewSupportExtra,
} from "@movo/shared";
import { PrismaClient } from "../generated/prisma/client";
import { ALERT_SQL } from "./admin-shipment-repository";

const DAY_MS = 24 * 60 * 60 * 1000;

const toBreakdown = (rows: Array<{ key: string; count: number }>): OverviewBreakdownRow[] =>
  rows.map((row) => ({ key: row.key, count: row.count }));

const isoOf = (date: Date | null | undefined): string | null => date?.toISOString() ?? null;

/**
 * MOVO-342 (ADR-025, DD-058): las bandejas de la home del panel que viven en este servicio. Cada una es una cuenta en
 * vivo, sin tablas precalculadas. El plazo y si se pasó los agrega `svc-admin` (`toOverviewInbox`).
 */
export interface AdminOverviewRepository {
  disputes(now: Date): Promise<OverviewInboxSource<OverviewDisputesExtra>>;
  support(): Promise<OverviewInboxSource<OverviewSupportExtra>>;
  shipmentAlerts(): Promise<OverviewInboxSource<OverviewShipmentAlertsExtra>>;
  flaggedMessages(now: Date): Promise<OverviewInboxSource>;
  /** Lo que `svc-admin` no puede armar solo con el id de un objetivo de la bitácora. Un id inexistente no vuelve. */
  auditTargets(request: AuditTargetsRequest): Promise<AuditTargetsResponse>;
}

export function createAdminOverviewRepository(db: PrismaClient): AdminOverviewRepository {
  return {
    async disputes(now) {
      const yesterday = new Date(now.getTime() - DAY_MS);
      const [totals, breakdown] = await Promise.all([
        // "Ayer" no distingue `open` de `resolving` (no se guarda cuándo pasó a `resolving`): cuenta las que todavía no
        // estaban resueltas a esa hora. Es la mejor reconstrucción sin tabla de historial (DD-058).
        db.$queryRaw<Array<{ count: number; awaiting: number; oldest: Date | null; yesterday: number }>>`
          SELECT (COUNT(*) FILTER (WHERE d.status::text = 'open'))::int AS count,
                 (COUNT(*) FILTER (WHERE d.status::text = 'resolving'))::int AS awaiting,
                 MIN(d.opened_at) FILTER (WHERE d.status::text = 'open') AS oldest,
                 (COUNT(*) FILTER (WHERE d.opened_at <= ${yesterday} AND (d.resolved_at IS NULL OR d.resolved_at > ${yesterday})))::int AS yesterday
          FROM shipments.disputes d`,
        db.$queryRaw<Array<{ key: string; count: number }>>`
          SELECT d.reason::text AS key, COUNT(*)::int AS count
          FROM shipments.disputes d
          WHERE d.status::text = 'open'
          GROUP BY d.reason
          ORDER BY count DESC, key ASC`,
      ]);
      const row = totals[0];
      return {
        count: row?.count ?? 0,
        awaitingPayment: row?.awaiting ?? 0,
        oldestAt: isoOf(row?.oldest),
        yesterdayCount: row?.yesterday ?? 0,
        breakdown: toBreakdown(breakdown),
      };
    },

    async support() {
      // `open` es "le toca responder al equipo": una respuesta del agente la pasa a `awaiting_user` y un mensaje del
      // usuario la devuelve. La espera se mide desde `last_user_message_at`, igual que `waitMinutes`. Sin "ayer": el
      // estado de una conversación a una hora pasada no se puede reconstruir.
      const [totals, breakdown] = await Promise.all([
        db.$queryRaw<Array<{ count: number; urgent: number; oldest: Date | null }>>`
          SELECT COUNT(*)::int AS count,
                 (COUNT(*) FILTER (WHERE c.priority::text = 'urgent'))::int AS urgent,
                 MIN(c.last_user_message_at) AS oldest
          FROM shipments.support_conversations c
          WHERE c.status::text = 'open'`,
        db.$queryRaw<Array<{ key: string; count: number }>>`
          SELECT c.topic::text AS key, COUNT(*)::int AS count
          FROM shipments.support_conversations c
          WHERE c.status::text = 'open'
          GROUP BY c.topic
          ORDER BY count DESC, key ASC`,
      ]);
      const row = totals[0];
      return {
        count: row?.count ?? 0,
        urgent: row?.urgent ?? 0,
        oldestAt: isoOf(row?.oldest),
        yesterdayCount: null,
        breakdown: toBreakdown(breakdown),
      };
    },

    async shipmentAlerts() {
      // `count` es lo mismo que `alertCounts.all` del listado: la regla es `ALERT_SQL`. Un `in_transit` demorado se
      // cuenta aparte en el desglose (`delayed`), porque por estado solo no lleva aviso.
      const rows = await db.$queryRaw<Array<{ key: string; count: number; oldest: Date | null }>>`
        SELECT CASE WHEN s.status::text = 'in_transit' THEN 'delayed' ELSE s.status::text END AS key,
               COUNT(*)::int AS count,
               MIN(COALESCE(s.transit_anomaly_flagged_at, s.last_status_changed_at, s.created_at)) AS oldest
        FROM shipments.shipments s
        WHERE ${ALERT_SQL}
        GROUP BY 1
        ORDER BY count DESC, key ASC`;
      const oldest = rows.reduce<Date | null>((min, row) => (row.oldest && (!min || row.oldest < min) ? row.oldest : min), null);
      return {
        count: rows.reduce((sum, row) => sum + row.count, 0),
        inTransit: rows.find((row) => row.key === "delayed")?.count ?? 0,
        oldestAt: isoOf(oldest),
        yesterdayCount: null,
        breakdown: toBreakdown(rows),
      };
    },

    async flaggedMessages(now) {
      // Sin estado de revisión, un mensaje moderado o un reporte de chat no saldrían nunca de la bandeja: se mira una
      // ventana móvil (DD-058). Por eso "ayer" sí se puede reconstruir: la misma ventana, un día antes.
      const windowMs = OVERVIEW_FLAGGED_MESSAGES_WINDOW_DAYS * DAY_MS;
      const since = new Date(now.getTime() - windowMs);
      const yesterday = new Date(now.getTime() - DAY_MS);
      const yesterdaySince = new Date(yesterday.getTime() - windowMs);
      const rows = await db.$queryRaw<Array<{ key: string; count: number; oldest: Date | null; yesterday: number }>>`
        SELECT 'moderated' AS key,
               (COUNT(*) FILTER (WHERE m.created_at >= ${since}))::int AS count,
               MIN(m.created_at) FILTER (WHERE m.created_at >= ${since}) AS oldest,
               (COUNT(*) FILTER (WHERE m.created_at >= ${yesterdaySince} AND m.created_at <= ${yesterday}))::int AS yesterday
        FROM shipments.chat_messages m
        WHERE m.moderated AND m.created_at >= ${yesterdaySince}
        UNION ALL
        SELECT 'chat_report' AS key,
               (COUNT(*) FILTER (WHERE r.created_at >= ${since}))::int AS count,
               MIN(r.created_at) FILTER (WHERE r.created_at >= ${since}) AS oldest,
               (COUNT(*) FILTER (WHERE r.created_at >= ${yesterdaySince} AND r.created_at <= ${yesterday}))::int AS yesterday
        FROM shipments.chat_reports r
        WHERE r.created_at >= ${yesterdaySince}`;
      const oldest = rows.reduce<Date | null>((min, row) => (row.oldest && (!min || row.oldest < min) ? row.oldest : min), null);
      return {
        count: rows.reduce((sum, row) => sum + row.count, 0),
        oldestAt: isoOf(oldest),
        yesterdayCount: rows.reduce((sum, row) => sum + row.yesterday, 0),
        breakdown: toBreakdown(rows.filter((row) => row.count > 0).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))),
      };
    },

    async auditTargets(request) {
      const [disputes, chatReports, conversations] = await Promise.all([
        db.dispute.findMany({ where: { id: { in: request.disputes } }, select: { id: true, shipmentId: true } }),
        db.chatReport.findMany({ where: { id: { in: request.chatReports } }, select: { id: true, shipmentId: true } }),
        db.supportConversation.findMany({ where: { id: { in: request.supportConversations } }, select: { id: true, codeNumber: true } }),
      ]);
      return {
        disputes: Object.fromEntries(disputes.map((row) => [row.id, { shipmentId: row.shipmentId }])),
        chatReports: Object.fromEntries(chatReports.map((row) => [row.id, { shipmentId: row.shipmentId }])),
        supportConversations: Object.fromEntries(conversations.map((row) => [row.id, { code: formatSupportCode(row.codeNumber) }])),
      };
    },
  };
}
