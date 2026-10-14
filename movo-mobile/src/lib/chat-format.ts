import type { ChatDeliveryStatus, ChatMessage, ChatParticipantRole } from "@movo/shared/dist/types/chat";
import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import type { ShipmentEvent } from "../api/shipments-client";

/**
 * MOVO-284: formateo puro del chat. Todo lo que no depende de React vive acá para
 * testearlo sin montar pantallas (agrupado de burbujas, separadores de día, tildes,
 * tarjetas de evento).
 */

/** Respuestas rápidas por rol (prototipo "Chat del envío · v2"). */
export const CHAT_QUICK_REPLIES: Record<ChatParticipantRole, readonly string[]> = {
  sender: ["Está listo para retirar", "Te espero en la puerta", "Tengo el QR listo"],
  carrier: ["Ya retiré el paquete", "Estoy llegando", "Llego en 10 min", "Estoy en la puerta"],
  receiver: ["Estoy en casa", "Puedo recibirlo ahora", "Tengo el QR listo", "¿Cuánto falta?"],
};

const ROLE_LABEL: Record<ChatParticipantRole, string> = {
  sender: "Emisor",
  carrier: "Transportista",
  receiver: "Receptor",
};

export function chatRoleLabel(role: ChatParticipantRole): string {
  return ROLE_LABEL[role];
}

/** "Ana, Diego y Luis" a partir de los primeros nombres. */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

/** "Ana Molina" → "Ana M." (primer nombre e inicial del apellido, como en el prototipo). */
export function shortName(fullName: string | null | undefined): string {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!;
  return `${parts[0]} ${parts[parts.length - 1]!.charAt(0).toUpperCase()}.`;
}

const TIME_FORMAT = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
const SHORT_DAY_FORMAT = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short" });
const WEEKDAY_FORMAT = new Intl.DateTimeFormat("es-AR", { weekday: "short" });

/** Misma hora local que muestra el resto de la app, "15:07". */
export function formatChatTime(iso: string): string {
  return TIME_FORMAT.format(new Date(iso));
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function dayDiff(iso: string, now: Date): number {
  return Math.round((startOfDay(now) - startOfDay(new Date(iso))) / 86_400_000);
}

/** Separador de día dentro de la conversación: "Hoy", "Ayer" o "12 oct". */
export function formatDayLabel(iso: string, now: Date = new Date()): string {
  const diff = dayDiff(iso, now);
  if (diff === 0) return "Hoy";
  if (diff === 1) return "Ayer";
  return SHORT_DAY_FORMAT.format(new Date(iso)).replace(".", "");
}

/** Hora de la fila en la lista: hoy la hora, ayer "Ayer", esta semana el día, si no la fecha. */
export function formatListTime(iso: string, now: Date = new Date()): string {
  const diff = dayDiff(iso, now);
  if (diff === 0) return formatChatTime(iso);
  if (diff === 1) return "Ayer";
  if (diff > 1 && diff < 7) {
    const weekday = WEEKDAY_FORMAT.format(new Date(iso)).replace(".", "");
    return weekday.charAt(0).toUpperCase() + weekday.slice(1);
  }
  return SHORT_DAY_FORMAT.format(new Date(iso)).replace(".", "");
}

export function deliveryStatusLabel(status: ChatDeliveryStatus): string {
  if (status === "read") return "Leído por todos";
  if (status === "delivered") return "Entregado";
  return "Enviado";
}

/** Contador de la cápsula: de 99 pasa a "99+". */
export function formatUnreadCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}

/** Mensaje propio que todavía no confirmó el servidor (envío optimista). */
export type LocalChatMessage = ChatMessage & { localState?: "sending" | "failed" };

export type ChatEventCard = { id: string; text: string; live: boolean; createdAt: string };

/** Quién mira la conversación y los nombres que necesitan los textos de las tarjetas. */
export type ChatEventViewer = {
  role: ChatParticipantRole | undefined;
  /** Primer nombre del transportista ("Diego"). */
  carrierFirstName: string | null;
  /** Primer nombre del receptor ("Luis"). */
  receiverFirstName: string | null;
};

/**
 * Tarjeta del envío para intercalar en la conversación, con el texto del prototipo según quién mira
 * ("Aceptaste el envío" para el transportista, "Diego aceptó el envío" para los demás). `null` si el
 * cambio de estado no merece una tarjeta (creación, publicación, pago). "Llegando" no existe: el
 * backend no tiene evento de cercanía.
 */
export function chatEventCard(event: ShipmentEvent, viewer: ChatEventViewer): ChatEventCard | null {
  const carrier = viewer.carrierFirstName ?? "El transportista";
  const receiver = viewer.receiverFirstName ?? "El receptor";
  const isCarrier = viewer.role === "carrier";
  const isReceiver = viewer.role === "receiver";
  const card = (text: string, live = false): ChatEventCard => ({ id: event.id, text, live, createdAt: event.createdAt });
  switch (event.toStatus) {
    case ShipmentStatus.ASSIGNMENT_PENDING:
    case ShipmentStatus.ASSIGNED_UNFUNDED:
      return card(isCarrier ? "Aceptaste el envío" : `${carrier} aceptó el envío`);
    case ShipmentStatus.IN_TRANSIT:
      return card(
        isCarrier ? "Escaneaste el QR de retiro" : isReceiver ? `${carrier} retiró el paquete` : `${carrier} escaneó el QR de retiro`,
        true,
      );
    case ShipmentStatus.DELIVERED:
      return card(isReceiver ? "Confirmaste la entrega con QR" : `${receiver} confirmó la entrega con QR`);
    case ShipmentStatus.DISPUTED:
      return card("Disputa abierta");
    case ShipmentStatus.CANCELLED:
      return card("Envío cancelado");
    default:
      return null;
  }
}

export type ChatTimelineItem =
  | { kind: "day"; key: string; label: string }
  | { kind: "event"; key: string; card: ChatEventCard }
  | {
      kind: "message";
      key: string;
      message: LocalChatMessage;
      mine: boolean;
      /** Primer mensaje de un grupo de la misma persona: lleva el nombre y el rol. */
      showName: boolean;
      /** Último mensaje del grupo (el más nuevo): lleva el avatar. */
      showAvatar: boolean;
      /** Separación chica dentro del grupo, mayor al empezar uno nuevo. */
      groupStart: boolean;
    };

/**
 * Conversación lista para dibujar, del MÁS NUEVO al más viejo (el `FlatList` va invertido):
 * mensajes y tarjetas de evento por fecha, con un separador de día antes del primer ítem de
 * cada día y las burbujas de una misma persona agrupadas.
 */
export function buildChatTimeline(params: {
  messages: readonly LocalChatMessage[];
  events: readonly ChatEventCard[];
  currentUserId: string | undefined;
  now?: Date;
}): ChatTimelineItem[] {
  const now = params.now ?? new Date();
  type Entry = { at: number; message?: LocalChatMessage; card?: ChatEventCard };
  const entries: Entry[] = [
    ...params.messages.map((message) => ({ at: Date.parse(message.createdAt), message })),
    ...params.events.map((card) => ({ at: Date.parse(card.createdAt), card })),
  ].sort((a, b) => a.at - b.at);

  const chronological: ChatTimelineItem[] = [];
  let lastDay: string | null = null;
  entries.forEach((entry, index) => {
    const iso = new Date(entry.at).toISOString();
    const day = new Date(entry.at).toDateString();
    if (day !== lastDay) {
      chronological.push({ kind: "day", key: `day-${day}`, label: formatDayLabel(iso, now) });
      lastDay = day;
    }
    if (entry.card) {
      chronological.push({ kind: "event", key: `event-${entry.card.id}`, card: entry.card });
      return;
    }
    const message = entry.message!;
    const prev = entries[index - 1]?.message;
    const next = entries[index + 1]?.message;
    const sameAsPrev = prev?.authorId === message.authorId && new Date(prev.createdAt).toDateString() === day;
    const sameAsNext = next?.authorId === message.authorId && new Date(next.createdAt).toDateString() === day;
    const mine = message.authorId === params.currentUserId;
    chronological.push({
      kind: "message",
      key: `message-${message.clientMessageId || message.id}`,
      message,
      mine,
      showName: !mine && !sameAsPrev,
      showAvatar: !mine && !sameAsNext,
      groupStart: !sameAsPrev,
    });
  });
  return chronological.reverse();
}

/**
 * Si el envío ya tiene chat para sus partes: `open` con transportista y sin entregar, `read_only` entregado o en
 * disputa, `null` si todavía no hay transportista o el envío se canceló. Misma regla que `resolveChatAccess` del
 * backend, para decidir si el detalle ofrece el acceso sin pedir la lista de chats.
 */
export function chatAvailability(status: ShipmentStatus, carrierId: string | null): "open" | "read_only" | null {
  if (!carrierId) return null;
  switch (status) {
    case ShipmentStatus.ASSIGNMENT_PENDING:
    case ShipmentStatus.ASSIGNED_UNFUNDED:
    case ShipmentStatus.ASSIGNED:
    case ShipmentStatus.IN_TRANSIT:
      return "open";
    case ShipmentStatus.DELIVERED:
    case ShipmentStatus.COMPLETED:
    case ShipmentStatus.DISPUTED:
      return "read_only";
    default:
      return null;
  }
}

/** Texto de la franja de solo lectura según por qué no se puede escribir. */
export function chatReadOnlyCopy(params: {
  archived: boolean;
  status: ShipmentStatus | undefined;
  isFormerReceiver: boolean;
}): string {
  if (params.isFormerReceiver) return "Le pasaste la recepción a otra persona. Podés leer la conversación, no escribir.";
  if (params.archived) return "Este chat está archivado. Podés leerlo, pero ya no admite mensajes.";
  if (params.status === ShipmentStatus.DISPUTED) return "El envío está en disputa. El chat queda en solo lectura.";
  return "El envío finalizó. El chat queda en solo lectura y se archiva en 24 h.";
}
