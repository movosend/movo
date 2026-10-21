import type { SupportStatus, SupportTopic } from "@movo/shared/dist/types/admin-support";
import type { SupportAttachment } from "@movo/shared/dist/types/admin-support";
import type {
  SupportConversationItem,
  SupportDeliveryStatus,
  SupportShipmentOption,
  SupportShipmentRole,
  SupportThreadMessage,
} from "@movo/shared/dist/types/support";
import type { ChatDeliveryStatus } from "@movo/shared/dist/types/chat";
import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { shipmentStatusLabel, shipmentStatusTone } from "./shipment-format";
import { shortName, type LocalChatMessage, type TimelineCard } from "./chat-format";

/**
 * MOVO-324: formateo puro de las consultas de soporte (lista, vista previa, conversación). Lo que no
 * depende de React vive acá para testearlo sin montar pantallas.
 */

/** Id con el que se agrupan y se reconocen los mensajes propios en el timeline compartido con el chat del envío. */
export const SUPPORT_ME_ID = "me";

export const SUPPORT_TOPIC_OPTIONS: readonly { value: SupportTopic; label: string }[] = [
  { value: "shipment", label: "Envío" },
  { value: "payments", label: "Pagos" },
  { value: "account", label: "Mi cuenta" },
  { value: "carrier", label: "Ser transportista" },
  { value: "security", label: "Seguridad" },
];

export function supportTopicLabel(topic: SupportTopic): string {
  return SUPPORT_TOPIC_OPTIONS.find((option) => option.value === topic)?.label ?? topic;
}

/** Texto de la píldora de estado de la lista (prototipo: Abierta / Esperando tu respuesta / Resuelta). */
export function supportStatusLabel(status: SupportStatus): string {
  if (status === "awaiting_user") return "Esperando tu respuesta";
  if (status === "resolved") return "Resuelta";
  return "Abierta";
}

export type SupportStatusTone = "warning" | "info" | "neutral";

export function supportStatusTone(status: SupportStatus): SupportStatusTone {
  if (status === "awaiting_user") return "warning";
  if (status === "resolved") return "neutral";
  return "info";
}

/** "Movo: …", "Vos: …" o "Foto" según quién escribió el último mensaje. */
export function supportLastMessagePreview(item: SupportConversationItem): string {
  const last = item.lastMessage;
  if (!last) return "Todavía no hay mensajes";
  const who = last.from === "agent" ? "Movo" : "Vos";
  const text = last.body.trim() ? last.body : last.hasAttachments ? "Foto" : "";
  return text ? `${who}: ${text}` : who;
}

/** Subtítulo del encabezado de la conversación: "SOP-1042 · Envío", o solo el tema mientras no hay código. */
export function supportHeaderSubtitle(conversation: Pick<SupportConversationItem, "code" | "topic"> | undefined, fallbackTopic?: SupportTopic): string {
  if (conversation) return `${conversation.code} · ${supportTopicLabel(conversation.topic)}`;
  return fallbackTopic ? supportTopicLabel(fallbackTopic) : "";
}

/** Total de no leídos de todas las consultas (contador del hub y de Perfil). */
export function supportTotalUnread(items: readonly SupportConversationItem[] | undefined): number {
  return (items ?? []).reduce((sum, item) => sum + item.unreadCount, 0);
}

const ROLE_LABEL: Record<SupportShipmentRole, string> = {
  sender: "Emisor",
  carrier: "Transportista",
  receiver: "Receptor",
};

export function supportShipmentRoleLabel(role: SupportShipmentRole): string {
  return ROLE_LABEL[role];
}

/** Estado del envío en una fila del selector, con su tono (mismo mapa que el resto de la app). */
export function supportShipmentStatus(option: Pick<SupportShipmentOption, "status">) {
  const status = option.status as ShipmentStatus;
  return { label: shipmentStatusLabel(status), tone: shipmentStatusTone(status) };
}

/** Línea del selector ya cerrado: "MOVO-48213 · En camino". */
export function supportShipmentSummary(option: Pick<SupportShipmentOption, "code" | "status">): string {
  const label = option.status ? supportShipmentStatus(option).label : "";
  return label ? `${option.code} · ${label}` : option.code;
}

/** Mensaje de soporte con la forma del chat del envío (para `ChatBubble` y el agrupado) más sus imágenes. */
export type SupportChatMessage = LocalChatMessage & { attachments: SupportAttachment[] };

/**
 * `SupportThreadMessage` del equipo o del usuario → mensaje del chat para reusar `ChatBubble` y el agrupado.
 * El autor del equipo se agrupa por nombre de pila (dos agentes seguidos son dos grupos).
 */
export function supportToChatMessage(message: SupportThreadMessage, localState?: "sending" | "failed"): SupportChatMessage {
  const mine = message.kind === "user";
  return {
    attachments: message.attachments,
    ...(localState ? { localState } : {}),
    id: message.id,
    shipmentId: message.conversationId,
    authorId: mine ? SUPPORT_ME_ID : `agent:${message.authorName ?? "movo"}`,
    authorName: message.authorName,
    body: message.body,
    clientMessageId: message.clientMessageId,
    moderated: message.moderated,
    hidden: false,
    deliveryStatus: mine ? (message.deliveryStatus as ChatDeliveryStatus | null) : null,
    createdAt: message.createdAt,
  };
}

/** Evento `system` → línea discreta de la conversación. */
export interface SupportEventCard extends TimelineCard {
  text: string;
}

export function supportToEventCard(message: SupportThreadMessage): SupportEventCard {
  return { id: message.id, text: message.body, createdAt: message.createdAt };
}

/** "Lucía · Movo" para la primera burbuja de un grupo del equipo. */
export function supportAgentLabel(authorName: string | null): string {
  const name = shortName(authorName).split(" ")[0];
  return name ? `${name} · Movo` : "Movo";
}

/** Tildes de los mensajes propios: enviado o leído por el equipo. */
export function supportDeliveryLabel(status: SupportDeliveryStatus | ChatDeliveryStatus): string {
  return status === "read" ? "Leído" : "Enviado";
}

/** Texto del cartel de una consulta resuelta (el campo de texto sigue habilitado). */
export const SUPPORT_RESOLVED_COPY = "Esta consulta está resuelta. Escribí de nuevo para reabrirla.";
