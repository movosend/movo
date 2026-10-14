import type { ChatListItem, ChatMessage, ChatMessagesPage } from "@movo/shared/dist/types/chat";
import { type InfiniteData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { chatClient } from "../api/chat-client";
import { moderationClient } from "../api/moderation-client";
import { invalidateBlockDependentQueries } from "./use-moderation";
import { useAuthStore } from "../store/auth-store";

/** MOVO-284: consultas y mutaciones del chat. La conversación en vivo las junta en `use-chat-conversation.ts`. */

export const chatKeys = {
  list: ["chat", "list"] as const,
  messages: (shipmentId: string) => ["chat", "messages", shipmentId] as const,
  participants: (shipmentId: string) => ["chat", "participants", shipmentId] as const,
};

const PAGE_SIZE = 30;

/** Lista "Chats": uno por envío con transportista. `refetchInterval` cubre cuando no hay WebSocket abierto. */
export function useChatList() {
  const isAuthenticated = useAuthStore((state) => state.status === "authenticated");
  return useQuery({
    queryKey: chatKeys.list,
    queryFn: () => chatClient.listChats(),
    enabled: isAuthenticated,
    select: (data) => data.items,
    refetchInterval: 60_000,
  });
}

/** Total de mensajes sin leer, para el contador del header de Inicio. */
export function totalUnread(items: readonly ChatListItem[] | undefined): number {
  return (items ?? []).reduce((sum, item) => sum + item.unreadCount, 0);
}

export function useChatParticipants(shipmentId: string | undefined) {
  return useQuery({
    queryKey: chatKeys.participants(shipmentId ?? ""),
    queryFn: () => chatClient.getParticipants(shipmentId!),
    enabled: !!shipmentId,
    select: (data) => data.participants,
    staleTime: 5 * 60_000,
  });
}

export function useChatMessages(shipmentId: string | undefined) {
  return useInfiniteQuery({
    queryKey: chatKeys.messages(shipmentId ?? ""),
    queryFn: ({ pageParam }) => chatClient.listMessages(shipmentId!, { cursor: pageParam, limit: PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!shipmentId,
  });
}

/** Mensajes del caché del más nuevo al más viejo, sin repetidos (un mensaje puede llegar por HTTP y por WebSocket). */
export function flattenMessages(data: InfiniteData<ChatMessagesPage> | undefined): ChatMessage[] {
  const seen = new Set<string>();
  const result: ChatMessage[] = [];
  for (const page of data?.pages ?? []) {
    for (const message of page.items) {
      const key = message.clientMessageId || message.id;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(message);
    }
  }
  return result;
}

/** Suma o reemplaza un mensaje en la primera página del caché, sin duplicar por `clientMessageId`. */
export function upsertMessageInCache(
  data: InfiniteData<ChatMessagesPage> | undefined,
  message: ChatMessage,
): InfiniteData<ChatMessagesPage> | undefined {
  if (!data || data.pages.length === 0) return data;
  const [first, ...rest] = data.pages;
  const exists = first.items.some((m) => m.id === message.id || m.clientMessageId === message.clientMessageId);
  const items = exists
    ? first.items.map((m) => (m.id === message.id || m.clientMessageId === message.clientMessageId ? message : m))
    : [message, ...first.items];
  return { ...data, pages: [{ ...first, items }, ...rest] };
}

export function useSendChatMessage(shipmentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ body, clientMessageId }: { body: string; clientMessageId: string }) =>
      chatClient.sendMessage(shipmentId, body, clientMessageId),
    onSuccess: (message) => {
      queryClient.setQueryData<InfiniteData<ChatMessagesPage>>(chatKeys.messages(shipmentId), (data) =>
        upsertMessageInCache(data, message),
      );
      void queryClient.invalidateQueries({ queryKey: chatKeys.list });
    },
  });
}

export function useMarkChatRead(shipmentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => chatClient.markRead(shipmentId),
    onSuccess: () => {
      // El contador de esta conversación en la lista baja a cero sin esperar al servidor.
      queryClient.setQueryData<{ items: ChatListItem[] }>(chatKeys.list, (data) =>
        data
          ? { items: data.items.map((item) => (item.shipmentId === shipmentId ? { ...item, unreadCount: 0 } : item)) }
          : data,
      );
    },
  });
}

export function useReportChat(shipmentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => chatClient.reportConversation(shipmentId),
    onSuccess: () => {
      queryClient.setQueryData<InfiniteData<ChatMessagesPage>>(chatKeys.messages(shipmentId), (data) =>
        data ? { ...data, pages: data.pages.map((page) => ({ ...page, reportedByMe: true })) } : data,
      );
    },
  });
}

/** Bloquear o desbloquear a un integrante desde "Tu seguridad": el id viaja en la variable porque hay uno por fila. */
export function useChatBlockToggle(options?: { onError?: (error: unknown) => void }) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, block }: { userId: string; block: boolean }) =>
      block ? moderationClient.blockUser(userId) : moderationClient.unblockUser(userId),
    onSuccess: (_data, { userId }) => {
      invalidateBlockDependentQueries(queryClient, userId);
      // El bloqueo cambia qué mensajes llegan ocultos, tanto en el historial como en la lista.
      void queryClient.invalidateQueries({ queryKey: ["chat"] });
    },
    onError: options?.onError,
  });
}
