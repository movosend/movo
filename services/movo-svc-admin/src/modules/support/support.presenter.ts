import {
  SupportAgentRef,
  SupportConversation,
  SupportConversationRow,
  SupportInternalMessage,
  SupportInternalRow,
  SupportMessage,
  SupportUserRole,
} from "@movo/shared";

/**
 * Nombre y roles de un id, resueltos (best-effort) con `svc-users`. Si no se resolvió, `nameOf` devuelve `fallback`
 * (un nombre que ya se tenga, como el de pila guardado en el mensaje) o, sin él, `UNKNOWN_USER_NAME`.
 */
export interface NameDirectory {
  nameOf(id: string, fallback?: string | null): string;
  rolesOf(id: string): string[];
}

/** Rol que muestra la bandeja: transportista si la cuenta tiene ese rol; si no, emisor (receptor no es un rol de cuenta). */
export function supportUserRole(roles: string[]): SupportUserRole {
  return roles.includes("carrier") ? "carrier" : "sender";
}

/** Ids cuyos nombres necesita una fila (usuario, agente asignado y autor del último mensaje). */
export function rowNameIds(row: SupportInternalRow): string[] {
  return [row.userId, row.assignedTo, row.lastMessage?.authorId ?? null].filter((id): id is string => id !== null);
}

/** Ids cuyos nombres necesita un mensaje (el agente o el actor del evento). */
export function messageNameIds(message: SupportInternalMessage): string[] {
  return message.authorId ? [message.authorId] : [];
}

const agentRef = (id: string, names: NameDirectory, fallback?: string | null): SupportAgentRef => ({
  id,
  fullName: names.nameOf(id, fallback),
});

export function toRow(row: SupportInternalRow, names: NameDirectory): SupportConversationRow {
  return {
    id: row.id,
    code: row.code,
    user: { id: row.userId, fullName: names.nameOf(row.userId), role: supportUserRole(names.rolesOf(row.userId)) },
    topic: row.topic,
    priority: row.priority,
    status: row.status,
    assignee: row.assignedTo ? agentRef(row.assignedTo, names) : null,
    unread: row.unread,
    lastMessage: row.lastMessage
      ? {
          from: row.lastMessage.from,
          authorId: row.lastMessage.authorId,
          authorName:
            row.lastMessage.from === "agent" && row.lastMessage.authorId
              ? names.nameOf(row.lastMessage.authorId)
              : names.nameOf(row.userId),
          body: row.lastMessage.body,
          hasAttachments: row.lastMessage.hasAttachments,
          createdAt: row.lastMessage.createdAt,
        }
      : null,
    waitMinutes: row.waitMinutes,
    shipment: row.shipment,
    tags: row.tags,
    lastActivityAt: row.lastActivityAt,
  };
}

export function toConversation(row: SupportInternalRow, names: NameDirectory): SupportConversation {
  return { ...toRow(row, names), createdAt: row.createdAt, resolvedAt: row.resolvedAt };
}

/**
 * Mensaje del panel. La nota del modelo (`note`) es `internal_note` en el contrato; los eventos del usuario (`system`,
 * sin actor) y los del equipo (`event`, con actor) son `system`. El autor de una respuesta o nota se muestra con el
 * nombre completo (el usuario ve el de pila guardado en el mensaje); sin `svc-users`, con ese nombre de pila.
 */
export function toMessage(message: SupportInternalMessage, names: NameDirectory): SupportMessage {
  const base = { id: message.id, conversationId: message.conversationId, createdAt: message.createdAt };
  const clientMessageId = message.clientMessageId ? { clientMessageId: message.clientMessageId } : {};
  const author = message.authorId ? agentRef(message.authorId, names, message.authorName) : { id: "", fullName: message.authorName ?? "" };
  switch (message.kind) {
    case "user":
      return { ...base, kind: "user", body: message.body, attachments: message.attachments };
    case "agent":
      return { ...base, ...clientMessageId, kind: "agent", body: message.body, attachments: message.attachments, author };
    case "note":
      return { ...base, ...clientMessageId, kind: "internal_note", body: message.body, attachments: message.attachments, author };
    case "event":
      // El nombre del actor queda guardado con el evento (el texto ya lo nombra): no depende de svc-users.
      return {
        ...base,
        kind: "system",
        body: message.body,
        actor: message.authorId ? { id: message.authorId, fullName: message.authorName ?? names.nameOf(message.authorId) } : null,
      };
    case "system":
      return { ...base, kind: "system", body: message.body, actor: null };
  }
}
