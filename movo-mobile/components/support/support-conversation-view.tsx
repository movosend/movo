import type { SupportShipmentRef } from "@movo/shared/dist/types/admin-support";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SUPPORT_MESSAGE_MAX_LENGTH } from "@movo/shared/dist/types/admin-support";
import { useLiveChatKeys } from "../../src/hooks/use-live-chat-keys";
import { useSupportPhotos } from "../../src/hooks/use-support-photos";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import type { SupportOutgoingPhoto } from "../../src/hooks/use-support-conversation";
import type { TimelineItem } from "../../src/lib/chat-format";
import {
  supportAgentLabel,
  supportDeliveryLabel,
  type SupportChatMessage,
  type SupportEventCard,
} from "../../src/lib/support-format";
import { ChatBubble } from "../chat/chat-bubble";
import { ChatComposer } from "../chat/chat-composer";
import { ChatDotBackground } from "../chat/chat-dot-background";
import { ChatHeader } from "../chat/chat-header";
import { ModerationBanner } from "../chat/moderation-banner";
import { ScrollToBottomButton } from "../chat/scroll-to-bottom-button";
import { ReportDraftPhotoRow } from "../profile/report-photos";
import { PhotoViewerModal } from "../shipments/photo-viewer-modal";
import { ErrorBanner } from "../ui/error-banner";
import { MovoIsotype } from "../ui/movo-isotype";
import { AttachPhotoButton } from "./attach-photo-button";
import { LinkedShipmentCard } from "./linked-shipment-card";
import { ResolvedBanner } from "./resolved-banner";
import { SupportEventLine } from "./support-event-line";

/** Distancia al final (en altura de la lista) a partir de la cual aparece "Ir al último mensaje". */
const SCROLL_AWAY_FALLBACK_PX = 600;
const AVATAR = 28;

export type SupportTimelineItem = TimelineItem<SupportChatMessage, SupportEventCard>;

export interface SupportConversationViewProps {
  conversationId?: string;
  subtitle: string;
  shipment?: SupportShipmentRef | null;
  timeline: SupportTimelineItem[];
  isLoading?: boolean;
  errorMessage?: string | null;
  onRetryLoad?: () => void;
  isEmpty?: boolean;
  resolved?: boolean;
  /** Sin composer (la consulta todavía se está creando). */
  composerHidden?: boolean;
  onSend?: (body: string, photos: SupportOutgoingPhoto[]) => boolean;
  onRetryMessage?: (clientMessageId: string) => void;
  onDiscardMessage?: (clientMessageId: string) => void;
  sendError?: string | null;
  moderationWarning?: boolean;
  onDismissModeration?: () => void;
  loadOlder?: () => void;
  isLoadingOlder?: boolean;
  /** Las URLs de los adjuntos vencen: al abrir el visor se piden de nuevo. */
  onRefreshAttachments?: () => void;
  onBack: () => void;
  onOpenShipment?: () => void;
}

/**
 * MOVO-324: la conversación de soporte, calcada de la pantalla del chat del envío (`shipments/[id]/chat.tsx`) con los
 * mismos componentes. Es solo presentación: la consulta real (`support/[id]`) y la que se está creando
 * (`support/pending`) le pasan su timeline y sus acciones.
 */
export function SupportConversationView(props: SupportConversationViewProps) {
  const colors = useThemeColors();
  const photos = useSupportPhotos(props.conversationId);
  const [viewer, setViewer] = useState<{ key: string; index: number } | null>(null);

  const listRef = useRef<FlatList<SupportTimelineItem>>(null);
  const listHeightRef = useRef(SCROLL_AWAY_FALLBACK_PX);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const awayRef = useRef(false);
  const [newWhileAway, setNewWhileAway] = useState(0);
  const { liveKeys, arrivals } = useLiveChatKeys(props.timeline, !props.isLoading);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    // La lista va invertida: el offset 0 es el último mensaje.
    const away = event.nativeEvent.contentOffset.y > listHeightRef.current;
    if (away === awayRef.current) return;
    awayRef.current = away;
    setAwayFromBottom(away);
    if (!away) setNewWhileAway(0);
  }, []);

  const scrollToBottom = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, []);

  // Los mensajes que llegan con el usuario arriba no lo mueven y se cuentan; uno propio siempre baja.
  useEffect(() => {
    let incoming = 0;
    for (const item of arrivals) {
      if (item.kind !== "message") continue;
      if (item.message.localState === "sending") scrollToBottom();
      else incoming += 1;
    }
    if (incoming > 0 && awayRef.current) setNewWhileAway((count) => count + incoming);
  }, [arrivals, scrollToBottom]);

  const openViewer = (key: string, index: number) => {
    props.onRefreshAttachments?.();
    setViewer({ key, index });
  };
  const viewerMessage = viewer
    ? props.timeline.find((item) => item.kind === "message" && item.key === viewer.key)
    : undefined;
  const viewerPhotos = viewerMessage && viewerMessage.kind === "message" ? viewerMessage.message.attachments : [];

  const send = (body: string): boolean => {
    const outgoing = photos.photos.flatMap((p) => (p.status === "uploaded" && p.attachmentId ? [{ attachmentId: p.attachmentId, localUri: p.localUri }] : []));
    const sent = props.onSend?.(body, outgoing) ?? false;
    if (sent) photos.reset();
    return sent;
  };

  const renderItem = ({ item }: { item: SupportTimelineItem }) => {
    if (item.kind === "day") {
      return (
        <View className="items-center" style={{ marginTop: 6, marginBottom: 6 }}>
          <Text className="font-sans-medium text-caption uppercase text-fg-3">{item.label}</Text>
        </View>
      );
    }
    if (item.kind === "event") return <SupportEventLine card={item.card} testID={`support-event-${item.card.id}`} />;
    return (
      <ChatBubble
        testID={`support-message-${item.message.clientMessageId || item.message.id}`}
        message={item.message}
        mine={item.mine}
        authorLabel={item.mine ? undefined : supportAgentLabel(item.message.authorName)}
        showName={item.showName}
        showAvatar={item.showAvatar}
        groupStart={item.groupStart}
        animateIn={liveKeys.has(item.key)}
        avatarNode={<MovoIsotype size={AVATAR} borderRadius={AVATAR / 2} testID="support-agent-isotype" />}
        attachments={item.message.attachments}
        onPressAttachment={(index) => openViewer(item.key, index)}
        statusLabel={supportDeliveryLabel}
        onRetry={props.onRetryMessage}
        onDiscard={props.onDiscardMessage}
      />
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <ChatHeader
        title="Soporte de Movo"
        subtitle={props.subtitle}
        onBack={props.onBack}
        trailing={<MovoIsotype size={30} borderRadius={15} />}
      />
      {props.shipment ? (
        <LinkedShipmentCard testID="support-linked-shipment" shipment={props.shipment} onPress={() => props.onOpenShipment?.()} />
      ) : null}

      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View
          className="flex-1"
          style={{ marginTop: 10 }}
          onLayout={(event: LayoutChangeEvent) => {
            listHeightRef.current = event.nativeEvent.layout.height || SCROLL_AWAY_FALLBACK_PX;
          }}
        >
          <ChatDotBackground />
          {props.isLoading ? (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator color={colors.fg1} />
            </View>
          ) : props.errorMessage ? (
            <View className="px-5 pt-4">
              <ErrorBanner testID="support-error" message={props.errorMessage} />
              <Pressable testID="support-retry" onPress={props.onRetryLoad}>
                <Text className="font-sans-semibold text-small text-fg">Reintentar</Text>
              </Pressable>
            </View>
          ) : (
            <FlatList
              ref={listRef}
              testID="support-list"
              inverted
              data={props.timeline}
              keyExtractor={(item) => item.key}
              renderItem={renderItem}
              contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 8, paddingBottom: 12 }}
              onScroll={handleScroll}
              scrollEventThrottle={64}
              onEndReached={props.loadOlder}
              onEndReachedThreshold={0.4}
              keyboardShouldPersistTaps="handled"
              ListFooterComponent={props.isLoadingOlder ? <ActivityIndicator className="my-3" color={colors.fg3} /> : null}
            />
          )}
          <ScrollToBottomButton visible={awayFromBottom} newCount={newWhileAway} onPress={scrollToBottom} />
        </View>

        <ModerationBanner visible={!!props.moderationWarning} onDismiss={props.onDismissModeration ?? (() => undefined)} />
        <ResolvedBanner visible={!!props.resolved && !props.isLoading && !props.errorMessage} />
        {props.sendError ? (
          <View className="px-4">
            <ErrorBanner testID="support-send-error" message={props.sendError} />
          </View>
        ) : null}

        {!props.isLoading && !props.errorMessage && !props.composerHidden ? (
          <ChatComposer
            testID="support-composer"
            canWrite
            readOnlyCopy=""
            onSend={send}
            maxLength={SUPPORT_MESSAGE_MAX_LENGTH}
            allowEmpty={photos.photos.length > 0}
            sendDisabled={photos.hasPending}
            leftAction={<AttachPhotoButton testID="support-attach" onPress={photos.add} disabled={!photos.canAddMore} />}
            attachmentsSlot={
              photos.photos.length > 0 ? (
                <ReportDraftPhotoRow
                  testID="support-draft-photos"
                  photos={photos.photos}
                  max={photos.max}
                  onRemove={photos.remove}
                  onRetry={photos.retry}
                />
              ) : undefined
            }
          />
        ) : null}
      </KeyboardAvoidingView>

      <PhotoViewerModal
        testID="support-photo-viewer"
        visible={!!viewer && viewerPhotos.length > 0}
        photos={viewerPhotos}
        initialIndex={viewer?.index ?? 0}
        onClose={() => setViewer(null)}
      />
    </SafeAreaView>
  );
}
