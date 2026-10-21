import { SUPPORT_MESSAGE_MAX_LENGTH } from "@movo/shared/dist/types/admin-support";
import type { SupportAttachment } from "@movo/shared/dist/types/admin-support";
import type { SupportRealtimeEvent, SupportThreadMessage } from "@movo/shared/dist/types/support";
import { useQueryClient } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isSupportMock } from "../api/support-client";
import { dismissSupportNotifications } from "../lib/dismiss-support-notifications";
import { buildTimeline } from "../lib/chat-format";
import {
  SUPPORT_ME_ID,
  supportToChatMessage,
  supportToEventCard,
  type SupportChatMessage,
  type SupportEventCard,
} from "../lib/support-format";
import { useSupportChannel } from "./use-support-channel";
import {
  flattenSupportMessages,
  patchSupportListWithMessage,
  patchSupportThreadStatus,
  refetchFirstSupportPage,
  supportKeys,
  upsertSupportMessageInCache,
  useMarkSupportRead,
  useSendSupportMessage,
  useSupportMessages,
} from "./use-support";
import type { InfiniteData } from "@tanstack/react-query";
import type { SupportThreadPage } from "@movo/shared/dist/types/support";

const READ_THROTTLE_MS = 2_000;
const RECEIPT_REFETCH_DEBOUNCE_MS = 400;

/** Mensaje propio que todavía no confirmó el servidor, con lo necesario para reenviarlo con el mismo id. */
interface LocalSupportMessage {
  message: SupportThreadMessage;
  localState: "sending" | "failed";
  attachmentIds: string[];
}

export interface SupportOutgoingPhoto {
  attachmentId: string;
  localUri: string;
}

/**
 * MOVO-324: todo lo que necesita la pantalla de una consulta. Junta el historial paginado, el WebSocket de
 * recepción, el envío optimista (mismo `clientMessageId` al reintentar, así el servidor no duplica) y el aviso de
 * lectura. Mismo molde que `use-chat-conversation.ts`; la pantalla solo dibuja lo que devuelve.
 */
export function useSupportConversation(
  conversationId: string | undefined,
  options: { focused?: boolean; initialModerationWarning?: boolean } = {},
) {
  const focused = options.focused ?? true;
  const queryClient = useQueryClient();

  const messagesQuery = useSupportMessages(conversationId);
  const sendMutation = useSendSupportMessage(conversationId ?? "");
  const markReadMutation = useMarkSupportRead(conversationId ?? "");

  const [local, setLocal] = useState<LocalSupportMessage[]>([]);
  const [moderationWarning, setModerationWarning] = useState(options.initialModerationWarning ?? false);
  const [sendError, setSendError] = useState<unknown>(null);
  const [unavailable, setUnavailable] = useState(false);

  const conversation = messagesQuery.data?.pages[0]?.conversation;
  const resolved = conversation?.status === "resolved";

  // Las notas internas no existen para el cliente: aunque el servidor mandara una por error, no se dibuja.
  const serverMessages = useMemo(
    () => flattenSupportMessages(messagesQuery.data).filter((m) => m.kind === "user" || m.kind === "agent" || m.kind === "system"),
    [messagesQuery.data],
  );

  // Un mensaje propio deja de ser "local" cuando el servidor ya lo devolvió.
  const pendingLocal = useMemo(() => {
    const confirmed = new Set(serverMessages.filter((m) => m.kind === "user").map((m) => m.clientMessageId));
    return local.filter((l) => !confirmed.has(l.message.clientMessageId));
  }, [local, serverMessages]);

  const timeline = useMemo(() => {
    const messages: SupportChatMessage[] = [
      ...pendingLocal.map((l) => supportToChatMessage(l.message, l.localState)),
      ...serverMessages.filter((m) => m.kind !== "system").map((m) => supportToChatMessage(m)),
    ];
    const events: SupportEventCard[] = serverMessages.filter((m) => m.kind === "system").map(supportToEventCard);
    return buildTimeline<SupportChatMessage, SupportEventCard>({ messages, events, currentUserId: SUPPORT_ME_ID });
  }, [pendingLocal, serverMessages]);

  // ── Leído: al ver la conversación y cuando llega un mensaje con la pantalla al frente.
  const lastReadAtRef = useRef(0);
  const readTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markReadRef = useRef(markReadMutation.mutate);
  markReadRef.current = markReadMutation.mutate;
  const markRead = useCallback(() => {
    if (!conversationId || !focused) return;
    const elapsed = Date.now() - lastReadAtRef.current;
    if (elapsed < READ_THROTTLE_MS) {
      // Dentro de la ventana no se descarta: se agenda una sola llamada para cuando venza, así el último mensaje
      // queda leído.
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
  }, [conversationId, focused]);
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

  // Con la consulta a la vista, sus notificaciones de la bandeja ya no hacen falta.
  useEffect(() => {
    if (conversationId && focused) void dismissSupportNotifications(conversationId);
  }, [conversationId, focused, firstItemId]);

  // Al salir se vuelve a pedir la lista: el contador de Perfil muestra el total real, no el último que vio.
  useEffect(
    () => () => {
      void queryClient.invalidateQueries({ queryKey: supportKeys.list });
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
  const scheduleRefetch = () => {
    if (!conversationId) return;
    if (receiptTimerRef.current) clearTimeout(receiptTimerRef.current);
    receiptTimerRef.current = setTimeout(() => refetchFirstSupportPage(queryClient, conversationId), RECEIPT_REFETCH_DEBOUNCE_MS);
  };

  const channel = useSupportChannel(conversationId, {
    // Sin la pantalla al frente (bloqueo, segundo plano) se cierra el socket: así el servidor ve al usuario
    // desconectado y le manda la push. Con el mock no hay servidor al que conectarse.
    enabled: !!conversationId && !messagesQuery.isError && focused && !isSupportMock() && !unavailable,
    onMessage: ({ message }: Extract<SupportRealtimeEvent, { type: "support_message" }>) => {
      if (!conversationId) return;
      queryClient.setQueryData<InfiniteData<SupportThreadPage>>(supportKeys.messages(conversationId), (data) =>
        upsertSupportMessageInCache(data, message),
      );
      patchSupportListWithMessage(queryClient, message, { fromMe: message.kind === "user", seen: focused });
      if (message.kind === "agent") markRead();
    },
    onStatus: ({ status }) => {
      if (!conversationId) return;
      patchSupportThreadStatus(queryClient, conversationId, status);
      // El evento `system` que acompaña al cambio ("marcó la consulta como resuelta") llega en el historial.
      scheduleRefetch();
    },
    onReceipt: scheduleRefetch,
    onConnected: () => {
      if (conversationId) refetchFirstSupportPage(queryClient, conversationId);
    },
    onTerminalClose: (code) => {
      if (code === 4004) setUnavailable(true);
    },
  });

  // ── Envío optimista.
  const attemptSend = useCallback(
    (body: string, clientMessageId: string, attachmentIds: string[]) => {
      setSendError(null);
      sendMutation.mutate(
        { body, clientMessageId, ...(attachmentIds.length > 0 ? { attachmentIds } : {}) },
        {
          onSuccess: (message) => {
            setLocal((prev) => prev.filter((l) => l.message.clientMessageId !== clientMessageId));
            if (message.moderated) setModerationWarning(true);
          },
          onError: (error) => {
            setSendError(error);
            setLocal((prev) =>
              prev.map((l) => (l.message.clientMessageId === clientMessageId ? { ...l, localState: "failed" } : l)),
            );
          },
        },
      );
    },
    [sendMutation],
  );

  /** `true` si salió (el campo se vacía); `false` si no se puede enviar todavía. */
  const send = useCallback(
    (rawBody: string, photos: readonly SupportOutgoingPhoto[] = []) => {
      const body = rawBody.trim();
      if (!conversationId || body.length > SUPPORT_MESSAGE_MAX_LENGTH || (body.length === 0 && photos.length === 0)) return false;
      const clientMessageId = Crypto.randomUUID();
      const attachments: SupportAttachment[] = photos.map((p) => ({ id: p.attachmentId, contentType: "image/jpeg", url: p.localUri }));
      const optimistic: SupportThreadMessage = {
        id: "",
        conversationId,
        kind: "user",
        authorName: null,
        body,
        clientMessageId,
        moderated: false,
        deliveryStatus: null,
        attachments,
        createdAt: new Date().toISOString(),
      };
      const attachmentIds = photos.map((p) => p.attachmentId);
      setLocal((prev) => [...prev, { message: optimistic, localState: "sending", attachmentIds }]);
      attemptSend(body, clientMessageId, attachmentIds);
      return true;
    },
    [conversationId, attemptSend],
  );

  const retry = useCallback(
    (clientMessageId: string) => {
      const failed = local.find((l) => l.message.clientMessageId === clientMessageId);
      if (!failed) return;
      setLocal((prev) => prev.map((l) => (l.message.clientMessageId === clientMessageId ? { ...l, localState: "sending" } : l)));
      attemptSend(failed.message.body, clientMessageId, failed.attachmentIds);
    },
    [local, attemptSend],
  );

  const discard = useCallback((clientMessageId: string) => {
    setLocal((prev) => prev.filter((l) => l.message.clientMessageId !== clientMessageId));
  }, []);

  /** Las URLs de los adjuntos son de vida corta: al abrir el visor se vuelve a pedir la primera página con URLs nuevas. */
  const refreshAttachments = useCallback(() => {
    if (conversationId) refetchFirstSupportPage(queryClient, conversationId);
  }, [conversationId, queryClient]);

  return {
    conversation,
    resolved,
    timeline,
    unavailable,
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
    refreshAttachments,
    channelState: channel.state,
  };
}
