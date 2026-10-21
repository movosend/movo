import type { SupportStatus } from "@movo/shared/dist/types/admin-support";
import type {
  SupportConversationItem,
  SupportCreateBody,
  SupportListResponse,
  SupportSendUserBody,
  SupportThreadMessage,
  SupportThreadPage,
} from "@movo/shared/dist/types/support";
import { type InfiniteData, type QueryClient, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supportClient } from "../api/support-client";
import { useAuthStore } from "../store/auth-store";

/** MOVO-324: consultas y mutaciones de soporte. La conversación en vivo las junta en `use-support-conversation.ts`. */

export const supportKeys = {
  all: ["support"] as const,
  list: ["support", "list"] as const,
  messages: (conversationId: string) => ["support", "messages", conversationId] as const,
  shipments: ["support", "shipments"] as const,
};

const PAGE_SIZE = 30;
const SHIPMENTS_PAGE_SIZE = 20;

/**
 * Cada cuánto se vuelve a pedir la lista. Sin WebSocket global, el contador de Perfil se mantiene al día con la
 * push en foreground (`useSupportUnreadSync`), el refresco al volver a primer plano y este polling de respaldo.
 */
const SUPPORT_LIST_POLL_MS = __DEV__ ? 15_000 : 60_000;

/** "Mis consultas", la más reciente primero. `enabled: false` es para quien la usa solo de pasada (el contador de Perfil). */
export function useSupportList({ enabled = true }: { enabled?: boolean } = {}) {
  const isAuthenticated = useAuthStore((state) => state.status === "authenticated");
  return useQuery({
    queryKey: supportKeys.list,
    queryFn: () => supportClient.list(),
    enabled: isAuthenticated && enabled,
    select: (data) => data.items,
    refetchInterval: SUPPORT_LIST_POLL_MS,
  });
}

export function useSupportMessages(conversationId: string | undefined) {
  return useInfiniteQuery({
    queryKey: supportKeys.messages(conversationId ?? ""),
    queryFn: ({ pageParam }) => supportClient.listMessages(conversationId!, { cursor: pageParam, limit: PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!conversationId,
  });
}

/** Envíos vinculables a una consulta nueva (cualquier rol), más recientes primero. */
export function useSupportShipments(enabled = true) {
  return useInfiniteQuery({
    queryKey: supportKeys.shipments,
    queryFn: ({ pageParam }) => supportClient.listShipments({ cursor: pageParam, limit: SHIPMENTS_PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });
}

/** Mensajes del caché del más nuevo al más viejo, sin repetidos (un mensaje puede llegar por HTTP y por WebSocket). */
export function flattenSupportMessages(data: InfiniteData<SupportThreadPage> | undefined): SupportThreadMessage[] {
  const seen = new Set<string>();
  const result: SupportThreadMessage[] = [];
  for (const page of data?.pages ?? []) {
    for (const message of page.items) {
      const key = message.kind === "user" && message.clientMessageId ? message.clientMessageId : message.id;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(message);
    }
  }
  return result;
}

function sameMessage(a: SupportThreadMessage, b: SupportThreadMessage): boolean {
  return a.id === b.id || (a.kind === "user" && b.kind === "user" && !!a.clientMessageId && a.clientMessageId === b.clientMessageId);
}

/** Suma o reemplaza un mensaje en la primera página del caché, sin duplicar por id ni por `clientMessageId`. */
export function upsertSupportMessageInCache(
  data: InfiniteData<SupportThreadPage> | undefined,
  message: SupportThreadMessage,
): InfiniteData<SupportThreadPage> | undefined {
  if (!data || data.pages.length === 0) return data;
  const [first, ...rest] = data.pages;
  const exists = first.items.some((m) => sameMessage(m, message));
  const items = exists ? first.items.map((m) => (sameMessage(m, message) ? message : m)) : [message, ...first.items];
  return { ...data, pages: [{ ...first, items }, ...rest] };
}

/** Cambia el estado de la consulta en el encabezado del historial cacheado (ej.: una resuelta que se reabre). */
export function patchSupportThreadStatus(queryClient: QueryClient, conversationId: string, status: SupportStatus): void {
  queryClient.setQueryData<InfiniteData<SupportThreadPage>>(supportKeys.messages(conversationId), (data) =>
    data
      ? {
          ...data,
          pages: data.pages.map((page, index) => (index === 0 ? { ...page, conversation: { ...page.conversation, status } } : page)),
        }
      : data,
  );
}

/**
 * Deja solo la primera página en el caché y la vuelve a pedir. Los tildes, los eventos del sistema y lo que cambió
 * mientras el canal estuvo caído están en los mensajes recientes (también trae URLs de adjuntos recién firmadas).
 */
export function refetchFirstSupportPage(queryClient: QueryClient, conversationId: string): void {
  queryClient.setQueryData<InfiniteData<SupportThreadPage>>(supportKeys.messages(conversationId), (data) =>
    data ? { pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) } : data,
  );
  void queryClient.invalidateQueries({ queryKey: supportKeys.messages(conversationId) });
}

/** Refleja un mensaje en la lista sin volver a pedirla. Si la consulta no está en la lista, se invalida. */
export function patchSupportListWithMessage(
  queryClient: QueryClient,
  message: SupportThreadMessage,
  options: { fromMe: boolean; seen: boolean },
): void {
  const current = queryClient.getQueryData<SupportListResponse>(supportKeys.list);
  if (!current || !current.items.some((item) => item.id === message.conversationId)) {
    void queryClient.invalidateQueries({ queryKey: supportKeys.list });
    return;
  }
  const items = current.items
    .map((item): SupportConversationItem => {
      if (item.id !== message.conversationId) return item;
      if (message.kind === "system") return { ...item, lastActivityAt: message.createdAt };
      return {
        ...item,
        lastMessage: {
          from: message.kind,
          authorName: message.authorName,
          body: message.body,
          hasAttachments: message.attachments.length > 0,
          createdAt: message.createdAt,
        },
        lastActivityAt: message.createdAt,
        unreadCount: options.fromMe || options.seen ? item.unreadCount : item.unreadCount + 1,
      };
    })
    .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  queryClient.setQueryData<SupportListResponse>(supportKeys.list, { items });
}

/** Suma un no leído a esa consulta en el caché sin esperar a la lista del servidor (push en foreground). */
export function bumpSupportUnread(queryClient: QueryClient, conversationId: string): void {
  queryClient.setQueryData<SupportListResponse>(supportKeys.list, (data) =>
    data
      ? { items: data.items.map((item) => (item.id === conversationId ? { ...item, unreadCount: item.unreadCount + 1 } : item)) }
      : data,
  );
}

export function useCreateSupportConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SupportCreateBody) => supportClient.create(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: supportKeys.list });
    },
  });
}

export function useSendSupportMessage(conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SupportSendUserBody) => supportClient.sendMessage(conversationId, body),
    onSuccess: (message) => {
      queryClient.setQueryData<InfiniteData<SupportThreadPage>>(supportKeys.messages(conversationId), (data) =>
        upsertSupportMessageInCache(data, message),
      );
      // Escribir sobre una resuelta la reabre; si estaba esperando al usuario, vuelve a "Abierta".
      patchSupportThreadStatus(queryClient, conversationId, "open");
      patchSupportListWithMessage(queryClient, message, { fromMe: true, seen: true });
      queryClient.setQueryData<SupportListResponse>(supportKeys.list, (data) =>
        data ? { items: data.items.map((item) => (item.id === conversationId ? { ...item, status: "open" } : item)) } : data,
      );
    },
  });
}

export function useMarkSupportRead(conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => supportClient.markRead(conversationId),
    onSuccess: () => {
      queryClient.setQueryData<SupportListResponse>(supportKeys.list, (data) =>
        data ? { items: data.items.map((item) => (item.id === conversationId ? { ...item, unreadCount: 0 } : item)) } : data,
      );
    },
  });
}
