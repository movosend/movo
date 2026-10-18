import { CHAT_MESSAGE_MAX_LENGTH } from "@movo/shared/dist/types/chat";
import type { ChatMessage } from "@movo/shared/dist/types/chat";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessagesPage } from "@movo/shared/dist/types/chat";
import { dismissChatNotifications } from "../lib/dismiss-chat-notifications";
import { useAuthStore } from "../store/auth-store";
import {
  buildChatTimeline,
  chatEventCard,
  eventsSinceCurrentAssignment,
  type ChatEventCard,
  type LocalChatMessage,
} from "../lib/chat-format";
import { useChatChannel } from "./use-chat-channel";
import {
  chatKeys,
  flattenMessages,
  patchChatListWithMessage,
  refetchFirstMessagesPage,
  upsertMessageInCache,
  useChatMessages,
  useChatParticipants,
  useMarkChatRead,
  useSendChatMessage,
} from "./use-chat";
import { useShipment, useShipmentEvents } from "./use-shipments";

const READ_THROTTLE_MS = 2_000;
const RECEIPT_REFETCH_DEBOUNCE_MS = 400;

/**
 * MOVO-284: todo lo que necesita la pantalla de conversación. Junta el historial paginado, el
 * WebSocket de recepción, el envío optimista (mismo `clientMessageId` al reintentar, así el
 * servidor no duplica) y el aviso de lectura. La pantalla solo dibuja lo que devuelve.
 */
export function useChatConversation(shipmentId: string | undefined, options: { focused?: boolean } = {}) {
  const focused = options.focused ?? true;
  const queryClient = useQueryClient();
  const meId = useAuthStore((state) => state.user?.userId);

  const shipmentQuery = useShipment(shipmentId);
  const eventsQuery = useShipmentEvents(shipmentId);
  const participantsQuery = useChatParticipants(shipmentId);
  const messagesQuery = useChatMessages(shipmentId);
  const sendMutation = useSendChatMessage(shipmentId ?? "");
  const markReadMutation = useMarkChatRead(shipmentId ?? "");

  const [local, setLocal] = useState<LocalChatMessage[]>([]);
  const [moderationWarning, setModerationWarning] = useState(false);
  const [sendError, setSendError] = useState<unknown>(null);

  const participants = participantsQuery.data ?? [];
  const me = participants.find((p) => p.userId === meId);
  const firstPage = messagesQuery.data?.pages[0];
  const access = firstPage?.access ?? "open";
  const archived = firstPage?.archived ?? false;
  const reportedByMe = firstPage?.reportedByMe ?? false;
  // Un integrante que ya no figura (receptor original, ADR-038) lee, pero no escribe.
  const isFormerReceiver = participantsQuery.isSuccess && !me && access === "read_only";
  const canWrite = access === "open" && !isFormerReceiver;

  const serverMessages = useMemo(() => flattenMessages(messagesQuery.data), [messagesQuery.data]);

  // Un mensaje propio deja de ser "local" cuando el servidor ya lo devolvió.
  const pendingLocal = useMemo(() => {
    const confirmed = new Set(serverMessages.map((m) => m.clientMessageId));
    return local.filter((m) => !confirmed.has(m.clientMessageId));
  }, [local, serverMessages]);

  const eventCards = useMemo<ChatEventCard[]>(() => {
    const viewer = {
      role: me?.role,
      carrierFirstName: participants.find((p) => p.role === "carrier")?.firstName ?? null,
      receiverFirstName: participants.find((p) => p.role === "receiver")?.firstName ?? null,
    };
    return eventsSinceCurrentAssignment(eventsQuery.data ?? [])
      .map((event) => chatEventCard(event, viewer))
      .filter((card): card is ChatEventCard => card !== null);
  }, [eventsQuery.data, participants, me?.role]);

  const timeline = useMemo(
    () =>
      buildChatTimeline({
        messages: [...pendingLocal, ...serverMessages],
        events: eventCards,
        currentUserId: meId,
      }),
    [pendingLocal, serverMessages, eventCards, meId],
  );

  // ── Leído: al ver la conversación y cuando llega un mensaje con la pantalla al frente.
  const lastReadAtRef = useRef(0);
  const readTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markReadRef = useRef(markReadMutation.mutate);
  markReadRef.current = markReadMutation.mutate;
  const markRead = useCallback(() => {
    if (!shipmentId || !focused) return;
    const elapsed = Date.now() - lastReadAtRef.current;
    if (elapsed < READ_THROTTLE_MS) {
      // Dentro de la ventana no se descarta: se agenda una sola llamada para cuando venza, así `last_read_at`
      // termina después del último mensaje (si no, el autor no vería el tilde de leído).
      if (!readTimerRef.current) {
        readTimerRef.current = setTimeout(() => {
          readTimerRef.current = null;
          lastReadAtRef.current = Date.now();
          markReadRef.current();
        }, READ_THROTTLE_MS - elapsed);
      }
      return;
    }
    lastReadAtRef.current = Date.now();
    markReadRef.current();
  }, [shipmentId, focused]);
  useEffect(
    () => () => {
      if (readTimerRef.current) clearTimeout(readTimerRef.current);
    },
    [],
  );
  // Si la pantalla deja de estar al frente, un aviso pendiente ya no corresponde: se leería sin que nadie lo vea.
  useEffect(() => {
    if (!focused && readTimerRef.current) {
      clearTimeout(readTimerRef.current);
      readTimerRef.current = null;
    }
  }, [focused]);

  const firstItemId = serverMessages[0]?.id;
  useEffect(() => {
    if (messagesQuery.isSuccess) markRead();
    // markRead cambia en cada render por la mutación: solo reaccionamos a la llegada de mensajes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messagesQuery.isSuccess, firstItemId, focused]);

  // Con la conversación a la vista, sus notificaciones de la bandeja ya no hacen falta.
  useEffect(() => {
    if (shipmentId && focused) void dismissChatNotifications(shipmentId);
  }, [shipmentId, focused, firstItemId]);

  // Al salir se vuelve a pedir la lista de chats: Inicio muestra el total real de no leídos, no el último que vio.
  useEffect(
    () => () => {
      void queryClient.invalidateQueries({ queryKey: chatKeys.list });
    },
    [queryClient],
  );

  // ── Tiempo real.
  const receiptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (receiptTimerRef.current) clearTimeout(receiptTimerRef.current);
    },
    [],
  );

  const channel = useChatChannel(shipmentId, {
    // Sin la pantalla al frente (bloqueo, segundo plano) se cierra el socket: así el servidor ve al usuario
    // desconectado, no lo da por entregado/leído y le manda la push.
    enabled: !!shipmentId && !messagesQuery.isError && focused,
    onMessage: (message: ChatMessage) => {
      if (!shipmentId) return;
      queryClient.setQueryData<InfiniteData<ChatMessagesPage>>(chatKeys.messages(shipmentId), (data) =>
        upsertMessageInCache(data, message),
      );
      patchChatListWithMessage(queryClient, message, { fromMe: message.authorId === meId, seen: focused });
      if (message.authorId !== meId) markRead();
    },
    onReceipt: () => {
      if (!shipmentId) return;
      // Los tildes los calcula el servidor: se pide la primera página de nuevo, con debounce.
      if (receiptTimerRef.current) clearTimeout(receiptTimerRef.current);
      receiptTimerRef.current = setTimeout(() => refetchFirstMessagesPage(queryClient, shipmentId), RECEIPT_REFETCH_DEBOUNCE_MS);
    },
    onConnected: () => {
      if (!shipmentId) return;
      refetchFirstMessagesPage(queryClient, shipmentId);
      // El envío pudo avanzar mientras el canal estuvo caído: las tarjetas ("Retiro confirmado", "Entregado") se actualizan.
      void queryClient.invalidateQueries({ queryKey: ["shipments", "events", shipmentId] });
    },
  });

  // ── Envío optimista.
  const attemptSend = useCallback(
    (body: string, clientMessageId: string) => {
      setSendError(null);
      sendMutation.mutate(
        { body, clientMessageId },
        {
          onSuccess: (message) => {
            setLocal((prev) => prev.filter((m) => m.clientMessageId !== clientMessageId));
            if (message.moderated) setModerationWarning(true);
          },
          onError: (error) => {
            setSendError(error);
            setLocal((prev) =>
              prev.map((m) => (m.clientMessageId === clientMessageId ? { ...m, localState: "failed" } : m)),
            );
          },
        },
      );
    },
    [sendMutation],
  );

  const send = useCallback(
    (rawBody: string) => {
      const body = rawBody.trim();
      if (!shipmentId || !meId || !canWrite || body.length === 0 || body.length > CHAT_MESSAGE_MAX_LENGTH) return false;
      const clientMessageId = Crypto.randomUUID();
      const optimistic: LocalChatMessage = {
        id: "",
        shipmentId,
        authorId: meId,
        authorName: me?.firstName ?? null,
        body,
        clientMessageId,
        moderated: false,
        hidden: false,
        deliveryStatus: null,
        createdAt: new Date().toISOString(),
        localState: "sending",
      };
      setLocal((prev) => [...prev, optimistic]);
      attemptSend(body, clientMessageId);
      return true;
    },
    [shipmentId, meId, canWrite, me?.firstName, attemptSend],
  );

  const retry = useCallback(
    (clientMessageId: string) => {
      const failed = local.find((m) => m.clientMessageId === clientMessageId);
      if (!failed) return;
      setLocal((prev) => prev.map((m) => (m.clientMessageId === clientMessageId ? { ...m, localState: "sending" } : m)));
      attemptSend(failed.body, clientMessageId);
    },
    [local, attemptSend],
  );

  const discard = useCallback((clientMessageId: string) => {
    setLocal((prev) => prev.filter((m) => m.clientMessageId !== clientMessageId));
  }, []);

  return {
    meId,
    myRole: me?.role,
    shipment: shipmentQuery.data,
    participants,
    timeline,
    access,
    archived,
    reportedByMe,
    isFormerReceiver,
    canWrite,
    isLoading: messagesQuery.isLoading,
    isError: messagesQuery.isError,
    error: messagesQuery.error,
    refetch: messagesQuery.refetch,
    hasOlder: !!messagesQuery.hasNextPage,
    loadOlder: () => {
      if (messagesQuery.hasNextPage && !messagesQuery.isFetchingNextPage) void messagesQuery.fetchNextPage();
    },
    isLoadingOlder: messagesQuery.isFetchingNextPage,
    isEmpty: messagesQuery.isSuccess && serverMessages.length === 0 && pendingLocal.length === 0,
    send,
    retry,
    discard,
    sendError,
    moderationWarning,
    dismissModerationWarning: () => setModerationWarning(false),
    channelState: channel.state,
  };
}
