import type { InfiniteData } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import type { SupportAttachment } from "@movo/shared/dist/types/admin-support";
import type { SupportThreadMessage, SupportThreadPage } from "@movo/shared/dist/types/support";
import { Redirect, router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SupportConversationView, type SupportTimelineItem } from "../../../components/support/support-conversation-view";
import { supportKeys, useCreateSupportConversation } from "../../../src/hooks/use-support";
import { buildTimeline } from "../../../src/lib/chat-format";
import { friendlyErrorMessage } from "../../../src/lib/error-messages";
import {
  SUPPORT_ME_ID,
  supportHeaderSubtitle,
  supportToChatMessage,
  type SupportChatMessage,
  type SupportEventCard,
} from "../../../src/lib/support-format";
import { useSupportDraftStore } from "../../../src/store/support-draft-store";

const CREATE_ERROR = "No pudimos enviar tu consulta.";

/**
 * MOVO-324: la consulta que se está creando. Se ve igual que una conversación (la burbuja en "Enviando…") pero
 * todavía no hay `conversationId`: hace el POST con el borrador de `support-draft-store`; si falla ofrece reintentar
 * con el mismo `clientMessageId` (idempotente) o descartar; si sale, pasa a la conversación real con el caché sembrado.
 */
export default function PendingSupportConversationScreen() {
  const queryClient = useQueryClient();
  const draft = useSupportDraftStore((s) => s.draft);
  const clearDraft = useSupportDraftStore((s) => s.clearDraft);
  const create = useCreateSupportConversation();
  const [failed, setFailed] = useState<unknown>(null);
  const startedRef = useRef(false);
  const doneRef = useRef(false);

  const attempt = useCallback(() => {
    if (!draft) return;
    setFailed(null);
    create.mutate(
      {
        topic: draft.topic,
        body: draft.body,
        clientMessageId: draft.clientMessageId,
        ...(draft.shipment ? { shipmentId: draft.shipment.id } : {}),
        ...(draft.attachments.length > 0 ? { attachmentIds: draft.attachments.map((a) => a.attachmentId) } : {}),
      },
      {
        onSuccess: ({ conversation, message }) => {
          doneRef.current = true;
          queryClient.setQueryData<InfiniteData<SupportThreadPage>>(supportKeys.messages(conversation.id), {
            pages: [{ items: [message], nextCursor: null, conversation }],
            pageParams: [undefined],
          });
          router.replace({ pathname: "/support/[id]", params: { id: conversation.id, ...(message.moderated ? { moderated: "1" } : {}) } } as never);
          clearDraft();
        },
        onError: (error) => setFailed(error),
      },
    );
    // `create` cambia en cada render: el borrador es lo único que define el intento.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, queryClient, clearDraft]);

  useEffect(() => {
    if (draft && !startedRef.current) {
      startedRef.current = true;
      attempt();
    }
  }, [draft, attempt]);

  const timeline: SupportTimelineItem[] = useMemo(() => {
    if (!draft) return [];
    const attachments: SupportAttachment[] = draft.attachments.map((a) => ({ id: a.attachmentId, contentType: "image/jpeg", url: a.localUri }));
    const optimistic: SupportThreadMessage = {
      id: "",
      conversationId: "",
      kind: "user",
      authorName: null,
      body: draft.body,
      clientMessageId: draft.clientMessageId,
      moderated: false,
      deliveryStatus: null,
      attachments,
      createdAt: draft.createdAt,
    };
    return buildTimeline<SupportChatMessage, SupportEventCard>({
      messages: [supportToChatMessage(optimistic, failed ? "failed" : "sending")],
      events: [],
      currentUserId: SUPPORT_ME_ID,
    });
  }, [draft, failed]);

  if (doneRef.current) return null;
  if (!draft) return <Redirect href={"/support/conversations" as never} />;

  const leave = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/support/conversations" as never);
  };

  return (
    <SupportConversationView
      subtitle={supportHeaderSubtitle(undefined, draft.topic)}
      shipment={draft.shipment}
      timeline={timeline}
      composerHidden
      sendError={failed ? friendlyErrorMessage(failed, CREATE_ERROR) : null}
      onRetryMessage={attempt}
      onDiscardMessage={() => {
        clearDraft();
        leave();
      }}
      onBack={leave}
    />
  );
}
