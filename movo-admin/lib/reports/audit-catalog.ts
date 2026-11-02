import type {
  AdminTargetType,
  AuditLogEntry,
  AuditOutcome,
} from "@movo/shared/src/types/admin"
import type {
  AdminAuditAction,
  AuditTargetRef,
} from "@movo/shared/src/types/admin-reports"
import { shipmentDisplayCode } from "@/lib/shipments/format"
import { shortId } from "@/lib/users/format"

/**
 * Cómo se lee cada acción de la bitácora (prototipo `Movo Admin Reportes v2`). El catálogo sigue a
 * `ADMIN_AUDIT_ACTIONS` de `@movo/shared` (las acciones que de verdad escribe `svc-admin`), no a las
 * del prototipo: una acción desconocida se muestra con su código.
 */
interface ActionMeta {
  label: string
  /** "suspendió a" → "Tomás suspendió a Julián Ortiz" (vista de línea de tiempo). */
  verb: string
  target: AdminTargetType
}

export const AUDIT_ACTION: Record<AdminAuditAction, ActionMeta> = {
  "user.suspend": { label: "Suspensión", verb: "suspendió a", target: "user" },
  "user.disable": {
    label: "Inhabilitación",
    verb: "inhabilitó a",
    target: "user",
  },
  "user.sanction_lift": {
    label: "Sanción levantada",
    verb: "levantó la sanción de",
    target: "user",
  },
  "user.sanction_withdraw": {
    label: "Reintento del retiro de actividad",
    verb: "reintentó retirar la actividad de",
    target: "user",
  },
  "user.ledger_adjust": {
    label: "Ajuste de cuenta corriente",
    verb: "ajustó la cuenta corriente de",
    target: "user",
  },
  "user.contact_update": {
    label: "Cambio de email o teléfono",
    verb: "cambió el contacto de",
    target: "user",
  },
  "user.sessions_revoke": {
    label: "Cierre de sesiones",
    verb: "cerró las sesiones de",
    target: "user",
  },
  "user.note_add": {
    label: "Nota interna",
    verb: "dejó una nota en la ficha de",
    target: "user",
  },
  "admin_role.grant": {
    label: "Alta de admin",
    verb: "le dio acceso al panel a",
    target: "admin_role",
  },
  "admin_role.revoke": {
    label: "Baja de admin",
    verb: "le sacó el acceso a",
    target: "admin_role",
  },
  "shipment.status_change": {
    label: "Cambio de estado",
    verb: "cambió el estado de",
    target: "shipment",
  },
  "support.attachment_request": {
    label: "Adjunto en soporte",
    verb: "subió un adjunto a",
    target: "support_conversation",
  },
  "support.assign": {
    label: "Asignación de consulta",
    verb: "asignó la consulta",
    target: "support_conversation",
  },
  "support.link_shipment": {
    label: "Envío vinculado",
    verb: "vinculó un envío a",
    target: "support_conversation",
  },
  "support.unlink_shipment": {
    label: "Envío desvinculado",
    verb: "desvinculó un envío de",
    target: "support_conversation",
  },
  "support.note": {
    label: "Nota en soporte",
    verb: "dejó una nota en",
    target: "support_conversation",
  },
  "support.priority": {
    label: "Cambio de prioridad",
    verb: "cambió la prioridad de",
    target: "support_conversation",
  },
  "support.reopen": {
    label: "Consulta reabierta",
    verb: "reabrió",
    target: "support_conversation",
  },
  "support.reply": {
    label: "Respuesta en soporte",
    verb: "respondió en",
    target: "support_conversation",
  },
  "support.resolve": {
    label: "Consulta resuelta",
    verb: "resolvió",
    target: "support_conversation",
  },
  "support.tags": {
    label: "Cambio de etiquetas",
    verb: "cambió las etiquetas de",
    target: "support_conversation",
  },
  "support.topic": {
    label: "Cambio de tema",
    verb: "cambió el tema de",
    target: "support_conversation",
  },
  "support.update": {
    label: "Actualización de consulta",
    verb: "actualizó",
    target: "support_conversation",
  },
  "dispute.note_add": {
    label: "Nota en disputa",
    verb: "dejó una nota en la disputa",
    target: "dispute",
  },
  "dispute.resolve": {
    label: "Disputa resuelta",
    verb: "resolvió la disputa",
    target: "dispute",
  },
  "report.export": {
    label: "Exportación de CSV",
    verb: "exportó",
    target: "report",
  },
}

export const TARGET_TYPE_LABEL: Record<AdminTargetType, string> = {
  user: "Usuario",
  admin_role: "Rol de admin",
  shipment: "Envío",
  dispute: "Disputa",
  support_conversation: "Conversación de soporte",
  chat_report: "Reporte de chat",
  user_report: "Reporte de usuario",
  report: "Exportación",
}

export const actionMeta = (action: string): ActionMeta | null =>
  (AUDIT_ACTION as Record<string, ActionMeta>)[action] ?? null

export const actionLabel = (action: string) =>
  actionMeta(action)?.label ?? action
export const actionVerb = (action: string) => actionMeta(action)?.verb ?? "hizo"

export const OUTCOME_LABEL: Record<AuditOutcome, string> = {
  succeeded: "Hecho",
  failed: "Falló",
  unknown: "Sin confirmar",
}
export const OUTCOME_TONE: Record<
  AuditOutcome,
  "success" | "danger" | "warning"
> = {
  succeeded: "success",
  failed: "danger",
  unknown: "warning",
}

/** Acciones agrupadas por tipo de objetivo, para el filtro "Acción". */
export function actionGroups(): {
  target: AdminTargetType
  actions: AdminAuditAction[]
}[] {
  const groups = new Map<AdminTargetType, AdminAuditAction[]>()
  for (const [action, meta] of Object.entries(AUDIT_ACTION) as [
    AdminAuditAction,
    ActionMeta,
  ][]) {
    if (action === "report.export") continue
    groups.set(meta.target, [...(groups.get(meta.target) ?? []), action])
  }
  return [...groups].map(([target, actions]) => ({ target, actions }))
}

export interface ResolvedTarget {
  label: string
  /** Segunda línea ("Usuario · 3F6C1A52"). */
  sub: string | null
  href: string | null
  /** Texto del botón del detalle. */
  openLabel: string
  /** Disputa: el link al reporte de disputas. */
  disputeId: string | null
}

/**
 * Etiqueta y destino del objetivo. Con `ref` (mapa `targets` de `svc-admin`) se muestra el nombre;
 * sin él, el id corto, y el link se arma igual cuando no hace falta otro dato.
 */
export function resolveTarget(
  entry: Pick<AuditLogEntry, "targetType" | "targetId">,
  ref?: AuditTargetRef
): ResolvedTarget {
  const { targetType: type, targetId: id } = entry
  switch (type) {
    case "user":
      return {
        label: ref?.label ?? shortId(id),
        sub: ref?.label ? shortId(id) : null,
        href: `/users/${id}`,
        openLabel: "Abrir ficha",
        disputeId: null,
      }
    case "shipment":
      return {
        label: shipmentDisplayCode(id),
        sub: null,
        href: `/shipments/${id}`,
        openLabel: "Abrir envío",
        disputeId: null,
      }
    case "dispute":
      return {
        label: ref?.label ?? `Disputa ${shortId(id)}`,
        sub: ref?.shipmentId ? shipmentDisplayCode(ref.shipmentId) : null,
        href: `/disputes/${id}`,
        openLabel: "Abrir disputa",
        disputeId: id,
      }
    case "support_conversation":
      return {
        label: ref?.label ?? shortId(id),
        sub: null,
        href: `/support/${id}`,
        openLabel: "Abrir conversación",
        disputeId: null,
      }
    case "chat_report":
      return {
        label: ref?.label ?? shortId(id),
        sub: ref?.shipmentId ? shipmentDisplayCode(ref.shipmentId) : null,
        href: ref?.shipmentId ? `/shipments/${ref.shipmentId}` : null,
        openLabel: "Abrir envío",
        disputeId: null,
      }
    case "user_report":
      return {
        label: ref?.label ?? shortId(id),
        sub: null,
        href: ref?.userId ? `/users/${ref.userId}` : null,
        openLabel: "Abrir ficha",
        disputeId: null,
      }
    case "report":
      return {
        label: "Bitácora",
        sub: null,
        href: null,
        openLabel: "Abrir bitácora",
        disputeId: null,
      }
    case "admin_role":
      return {
        label: ref?.label ?? id,
        sub: null,
        href: "/admins",
        openLabel: "Abrir admins",
        disputeId: null,
      }
  }
}
