import { FastifyInstance } from "fastify";
import {
  argentinaDayBounds,
  OVERVIEW_SLA_HOURS,
  OverviewBreakdownRow,
  OverviewInboxSource,
  OverviewPaymentsExtra,
  toArgentinaCalendarDateString,
} from "@movo/shared";

const HOUR_MS = 60 * 60 * 1000;

/**
 * MOVO-342 (ADR-025, DD-058): la bandeja de pagos de la home del panel. Interna, la consume `svc-admin`. Holds autorizados
 * que vencen hoy y capturas `failed`/`escalated`. Una disputa en `resolving` no se cuenta acá: la dueña es `svc-shipments`,
 * y la tarjeta de disputas ya la muestra en `awaitingPayment`. Sin "ayer": el estado de un hold a una hora pasada no se guarda.
 *
 * `overSla` se calcula acá porque un hold se pasa de plazo por lo que le falta para vencer, no por su antigüedad: un
 * hold vence en menos de 6 h, o una captura lleva más de 6 h trabada.
 */
export default async function paymentsAdminOverviewRoutes(app: FastifyInstance) {
  app.get("/overview", { schema: { hide: true } }, async (): Promise<OverviewInboxSource<OverviewPaymentsExtra>> => {
    const now = new Date();
    const slaMs = (OVERVIEW_SLA_HOURS.payments as number) * HOUR_MS;
    const today = argentinaDayBounds(toArgentinaCalendarDateString(now));

    const [holds, settlements] = await Promise.all([
      app.db.hold.findMany({
        where: { status: "authorized", expiresAt: { gt: now, lt: today.end } },
        select: { createdAt: true, expiresAt: true },
      }),
      app.db.settlement.findMany({
        where: { status: { in: ["failed", "escalated"] } },
        select: { status: true, updatedAt: true },
      }),
    ]);

    const failed = settlements.filter((row) => row.status === "failed").length;
    const escalated = settlements.length - failed;
    const breakdown: OverviewBreakdownRow[] = [
      { key: "hold_expiring", count: holds.length },
      { key: "capture_failed", count: failed },
      { key: "capture_escalated", count: escalated },
    ]
      .filter((row) => row.count > 0)
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

    const pendingSince = [...holds.map((row) => row.createdAt), ...settlements.map((row) => row.updatedAt)];
    const oldest = pendingSince.reduce<Date | null>((min, date) => (!min || date < min ? date : min), null);

    return {
      count: holds.length + settlements.length,
      holdsExpiringToday: holds.length,
      overSla:
        holds.some((row) => row.expiresAt && row.expiresAt.getTime() - now.getTime() < slaMs) ||
        settlements.some((row) => now.getTime() - row.updatedAt.getTime() > slaMs),
      oldestAt: oldest?.toISOString() ?? null,
      yesterdayCount: null,
      breakdown,
    };
  });
}
