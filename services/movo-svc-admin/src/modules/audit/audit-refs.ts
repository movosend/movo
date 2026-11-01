import { FastifyBaseLogger } from "fastify";
import { AdminAuditLogPage, AuditLogEntry, auditTargetKey, AuditTargetRef, AuditTargetsResponse } from "@movo/shared";
import { RequestContext } from "../../adapters/internal-client";
import { ShipmentsClient } from "../../adapters/shipments-client";
import { UsersClient } from "../../adapters/users-client";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AuditRefsDeps {
  usersClient: UsersClient;
  shipmentsClient: ShipmentsClient;
  logger: FastifyBaseLogger;
}

/**
 * Lee el dato con un servicio que puede estar caído: la bitácora se lista igual, sin esas etiquetas (el panel cae al id
 * corto). Es lo que la distingue de un `AdminBlock`: acá no hay nada que reintentar, solo se pierde el nombre.
 */
async function bestEffort<T>(load: () => Promise<T>, fallback: T, event: string, deps: AuditRefsDeps, ctx: RequestContext): Promise<T> {
  try {
    return await load();
  } catch (err) {
    deps.logger.warn({ err, event, requestId: ctx.requestId }, "No se pudieron resolver las referencias de la bitácora");
    return fallback;
  }
}

const idsOf = (entries: AuditLogEntry[], type: AuditLogEntry["targetType"]): string[] => [
  ...new Set(entries.filter((entry) => entry.targetType === type && UUID_PATTERN.test(entry.targetId)).map((entry) => entry.targetId)),
];

/** Nombres de los admins de estas filas. Los dados de baja también: no alcanza con `GET /admin/admins`. */
export async function resolveAuditAdmins(
  entries: AuditLogEntry[],
  deps: AuditRefsDeps,
  ctx: RequestContext,
): Promise<AdminAuditLogPage["admins"]> {
  const ids = [...new Set(entries.map((entry) => entry.adminId))];
  if (ids.length === 0) return {};
  const users = await bestEffort(() => deps.usersClient.getUserNames(ids, ctx), [], "audit_admin_names_unavailable", deps, ctx);
  return Object.fromEntries(users.map((user) => [user.id, { fullName: user.fullName }]));
}

/** MOVO-342: los dos mapas de `GET /admin/audit-log`, cada fuente por separado: si una falla, faltan solo sus claves. */
export async function resolveAuditRefs(
  entries: AuditLogEntry[],
  deps: AuditRefsDeps,
  ctx: RequestContext,
): Promise<Pick<AdminAuditLogPage, "admins" | "targets">> {
  const userTargets = idsOf(entries, "user");
  const adminRoleTargets = idsOf(entries, "admin_role");
  const adminIds = entries.map((entry) => entry.adminId);
  const nameIds = [...new Set([...adminIds, ...userTargets, ...adminRoleTargets])];
  const userReports = idsOf(entries, "user_report");
  const request = {
    disputes: idsOf(entries, "dispute"),
    chatReports: idsOf(entries, "chat_report"),
    supportConversations: idsOf(entries, "support_conversation"),
  };
  const noTargets: AuditTargetsResponse = { disputes: {}, chatReports: {}, supportConversations: {} };

  const [users, reported, owned] = await Promise.all([
    nameIds.length ? bestEffort(() => deps.usersClient.getUserNames(nameIds, ctx), [], "audit_admin_names_unavailable", deps, ctx) : [],
    userReports.length ? bestEffort(() => deps.usersClient.getReportedUsers(userReports, ctx), [], "audit_user_reports_unavailable", deps, ctx) : [],
    request.disputes.length || request.chatReports.length || request.supportConversations.length
      ? bestEffort(() => deps.shipmentsClient.getAuditTargets(request, ctx), noTargets, "audit_targets_unavailable", deps, ctx)
      : noTargets,
  ]);

  const nameOf = new Map(users.map((user) => [user.id, user.fullName]));
  const reportedOf = new Map(reported.map((report) => [report.id, report.reportedId]));
  const admins = Object.fromEntries(
    [...new Set(adminIds)].flatMap((id) => {
      const fullName = nameOf.get(id);
      return fullName ? [[id, { fullName }]] : [];
    }),
  );

  const targets: Record<string, AuditTargetRef> = {};
  for (const entry of entries) {
    const ref = targetRef(entry, { nameOf, reportedOf, owned });
    if (ref) targets[auditTargetKey(entry.targetType, entry.targetId)] = ref;
  }
  return { admins, targets };
}

function targetRef(
  entry: AuditLogEntry,
  sources: { nameOf: Map<string, string>; reportedOf: Map<string, string>; owned: AuditTargetsResponse },
): AuditTargetRef | null {
  const { nameOf, reportedOf, owned } = sources;
  const id = entry.targetId;
  switch (entry.targetType) {
    case "user": {
      const name = nameOf.get(id);
      return name ? { label: name } : null;
    }
    case "admin_role": {
      // El email queda en `context` al otorgar; una fila `failed` lo tiene como objetivo (MOVO-292).
      const email = typeof entry.context?.email === "string" ? entry.context.email : id.includes("@") ? id : null;
      const label = email ?? nameOf.get(id) ?? null;
      return label ? { label } : null;
    }
    // Mismo código corto que `shortShipmentId` de `svc-shipments`: se deriva del id, sin consultar.
    case "shipment":
      return { label: id.slice(0, 8).toUpperCase() };
    case "support_conversation": {
      const code = owned.supportConversations[id]?.code;
      return code ? { label: code } : null;
    }
    case "dispute": {
      const shipmentId = owned.disputes[id]?.shipmentId;
      return shipmentId ? { label: null, shipmentId } : null;
    }
    case "chat_report": {
      const shipmentId = owned.chatReports[id]?.shipmentId;
      return shipmentId ? { label: null, shipmentId } : null;
    }
    case "user_report": {
      const userId = reportedOf.get(id);
      return userId ? { label: null, userId } : null;
    }
    case "report":
      return null;
  }
}
