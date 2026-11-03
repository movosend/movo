import {
  formatSupportCode,
  supportShipmentCode,
  SupportAttachment,
  SupportInternalMessage,
  SupportInternalRow,
  SupportPriority,
  SupportStatus,
  SupportTag,
  SupportTopic,
} from "@movo/shared";
import { SupportConversationFacts, SupportMessageFacts } from "./support-rules";

/**
 * MOVO-322: reglas puras del lado del agente (bandeja del panel). Sin acceso a datos, como `support-rules.ts`; el
 * repositorio y el servicio de `modules/admin-support/` las aplican.
 */

/** Orden de la bandeja: urgente primero. El SQL del listado usa el mismo orden (`PRIORITY_RANK_SQL`). */
export const PRIORITY_RANK: Record<SupportPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

const PRIORITY_EVENT_LABEL: Record<SupportPriority, string> = {
  urgent: "urgente",
  high: "alta",
  normal: "normal",
  low: "baja",
};

const TOPIC_EVENT_LABEL: Record<SupportTopic, string> = {
  shipment: "envío",
  payments: "pagos",
  account: "cuenta",
  carrier: "ser transportista",
  security: "seguridad",
};

/**
 * Textos de los eventos del equipo: en tercera persona y sin depender de quién los lee (contrato de MOVO-323), los
 * mismos que el mock del panel (`movo-admin/lib/support/mock.ts`).
 */
export const supportEventText = {
  took: (actor: string) => `${actor} tomó la conversación`,
  assigned: (actor: string, assignee: string) => `${actor} asignó la conversación a ${assignee}`,
  unassigned: (actor: string) => `${actor} dejó la conversación sin asignar`,
  priority: (priority: SupportPriority) => `Prioridad: ${PRIORITY_EVENT_LABEL[priority]}`,
  topic: (topic: SupportTopic) => `Tema: ${TOPIC_EVENT_LABEL[topic]}`,
  linked: (shipmentId: string) => `Vinculada a #${supportShipmentCode(shipmentId)}`,
  unlinked: () => "Envío desvinculado",
  resolved: (actor: string) => `${actor} resolvió la conversación`,
  reopened: (actor: string) => `${actor} reabrió la conversación`,
};

/**
 * Minutos que el usuario lleva esperando una respuesta: solo en `open` (le toca al equipo), desde su último mensaje.
 * En `awaiting_user` y `resolved` no espera nadie del lado del usuario.
 */
export function waitMinutes(status: SupportStatus, lastUserMessageAt: Date, now: Date): number {
  if (status !== "open") return 0;
  return Math.max(0, Math.floor((now.getTime() - lastUserMessageAt.getTime()) / 60_000));
}

export interface SupportAdminConversationFacts extends SupportConversationFacts {
  priority: SupportPriority;
  assignedTo: string | null;
  tags: string[];
  createdAt: Date;
  lastUserMessageAt: Date;
  resolvedAt: Date | null;
}

/** Fila de la bandeja (sin nombres: los completa `svc-admin`). */
export function toInternalRow(
  conversation: SupportAdminConversationFacts,
  lastMessage: SupportMessageFacts | null,
  unread: number,
  now: Date
): SupportInternalRow {
  const visibleLast = lastMessage && (lastMessage.kind === "user" || lastMessage.kind === "agent") ? lastMessage : null;
  return {
    id: conversation.id,
    code: formatSupportCode(conversation.codeNumber),
    userId: conversation.userId,
    topic: conversation.topic,
    priority: conversation.priority,
    status: conversation.status,
    assignedTo: conversation.assignedTo,
    unread,
    lastMessage: visibleLast
      ? {
          from: visibleLast.kind as "user" | "agent",
          authorId: visibleLast.kind === "agent" ? visibleLast.authorId : null,
          body: visibleLast.body,
          hasAttachments: visibleLast.attachmentCount > 0,
          createdAt: visibleLast.createdAt.toISOString(),
        }
      : null,
    waitMinutes: waitMinutes(conversation.status, conversation.lastUserMessageAt, now),
    shipment: conversation.shipmentId
      ? { id: conversation.shipmentId, code: supportShipmentCode(conversation.shipmentId) }
      : null,
    tags: conversation.tags as SupportTag[],
    lastActivityAt: conversation.lastMessageAt.toISOString(),
    createdAt: conversation.createdAt.toISOString(),
    resolvedAt: conversation.resolvedAt ? conversation.resolvedAt.toISOString() : null,
  };
}

/** Mensaje con todos los `kind` (incluidas notas y eventos del equipo): solo para el panel. */
export function toInternalMessage(record: SupportMessageFacts, attachments: SupportAttachment[]): SupportInternalMessage {
  return {
    id: record.id,
    conversationId: record.conversationId,
    kind: record.kind,
    authorId: record.authorId,
    authorName: record.authorName,
    body: record.body,
    clientMessageId: record.clientMessageId,
    attachments,
    createdAt: record.createdAt.toISOString(),
  };
}
