import type { ChatListItem, ChatMessage, ChatMessagesPage } from "@movo/shared/dist/types/chat";
import { type InfiniteData, type QueryClient, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

/**
 * Cada cuánto se vuelve a pedir la lista de chats. Es un endpoint lento (resuelve a los integrantes contra
 * `svc-users`), así que en uso normal va a 60 s: el contador de Inicio lo mantienen al día la push en foreground
 * (`useChatUnreadSync`) y el refresco al volver a primer plano. En desarrollo va a 15 s porque un build local sin push
 * (`ENABLE_PUSH_NOTIFICATIONS=false`) no recibe nada de eso (MOVO-301).
 */
const CHAT_LIST_POLL_MS = __DEV__ ? 15_000 : 60_000;

/**
 * Lista "Chats": uno por envío con transportista. `refetchInterval` cubre cuando no hay WebSocket abierto.
 * `enabled: false` es para quien solo la usa si hay chat (la card del detalle del envío) y no quiere sumar un observer.
 */
export function useChatList({ enabled = true }: { enabled?: boolean } = {}) {
  const isAuthenticated = useAuthStore((state) => state.status === "authenticated");
  return useQuery({
    queryKey: chatKeys.list,
    queryFn: () => chatClient.listChats(),
    enabled: isAuthenticated && enabled,
    select: (data) => data.items,
    refetchInterval: CHAT_LIST_POLL_MS,
  });
}

/** Total de mensajes sin leer, para el contador del header de Inicio. */
export function totalUnread(items: readonly ChatListItem[] | undefined): number {
  return (items ?? []).reduce((sum, item) => sum + item.unreadCount, 0);
}

/**
 * MOVO-301: suma un no leído a esa conversación en el caché sin esperar a la lista del servidor, que tarda
 * varios segundos (resuelve a los integrantes contra `svc-users`). Se usa con una push `chat_message` en
 * foreground; la lista real que se pide después pisa este valor, así que no se desvía.
 */
export function bumpChatUnread(queryClient: QueryClient, shipmentId: string): void {
  queryClient.setQueryData<{ items: ChatListItem[] }>(chatKeys.list, (data) =>
    data
      ? {
          items: data.items.map((item) =>
            item.shipmentId === shipmentId ? { ...item, unreadCount: item.unreadCount + 1 } : item,
          ),
        }
      : data,
  );
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

/**
 * Deja solo la primera página en el caché y la vuelve a pedir. Los tildes y lo que cambió mientras el canal estuvo
 * caído están en los mensajes recientes: no hace falta repetir los GET de todas las páginas ya cargadas.
 */
export function refetchFirstMessagesPage(queryClient: QueryClient, shipmentId: string): void {
  queryClient.setQueryData<InfiniteData<ChatMessagesPage>>(chatKeys.messages(shipmentId), (data) =>
    data ? { pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) } : data,
  );
  void queryClient.invalidateQueries({ queryKey: chatKeys.messages(shipmentId) });
}

/**
 * Refleja un mensaje nuevo en la lista de chats sin volver a pedirla (cada pedido son consultas a `svc-users` en el
 * backend). Si el envío todavía no está en la lista se invalida, que es la única forma de traerlo.
 */
export function patchChatListWithMessage(
  queryClient: QueryClient,
  message: ChatMessage,
  options: { fromMe: boolean; seen: boolean },
): void {
  const current = queryClient.getQueryData<{ items: ChatListItem[] }>(chatKeys.list);
  if (!current || !current.items.some((item) => item.shipmentId === message.shipmentId)) {
    void queryClient.invalidateQueries({ queryKey: chatKeys.list });
    return;
  }
  const items = current.items
    .map((item) =>
      item.shipmentId === message.shipmentId
        ? {
            ...item,
            lastMessage: {
              authorId: message.authorId,
              authorName: message.authorName,
              body: message.hidden ? "" : message.body,
              hidden: message.hidden,
              createdAt: message.createdAt,
            },
            lastActivityAt: message.createdAt,
            // Un mensaje oculto (bloqueo) no suma, igual que en el servidor.
            unreadCount: options.fromMe || options.seen || message.hidden ? item.unreadCount : item.unreadCount + 1,
          }
        : item,
    )
    .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  queryClient.setQueryData<{ items: ChatListItem[] }>(chatKeys.list, { items });
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
      patchChatListWithMessage(queryClient, message, { fromMe: true, seen: true });
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
