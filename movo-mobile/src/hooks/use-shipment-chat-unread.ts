import { useChatList } from "./use-chat";

/** Mensajes sin leer del chat de un envío (0 sin chat). Lo comparten la card de la ruta y el sheet del seguimiento. */
export function useShipmentChatUnread(shipmentId: string, chat: "open" | "read_only" | null): number {
  const { data: chats } = useChatList({ enabled: chat !== null });
  if (!chat) return 0;
  return (chats ?? []).find((item) => item.shipmentId === shipmentId)?.unreadCount ?? 0;
}
