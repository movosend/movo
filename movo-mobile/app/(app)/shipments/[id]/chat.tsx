import { router, useIsFocused, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
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
import { ChatBubble } from "../../../../components/chat/chat-bubble";
import { ChatComposer } from "../../../../components/chat/chat-composer";
import { ChatEventCard } from "../../../../components/chat/chat-event-card";
import { ChatSafetySheet, type SafetyTarget } from "../../../../components/chat/chat-safety-sheet";
import { ModerationBanner } from "../../../../components/chat/moderation-banner";
import { QuickReplies } from "../../../../components/chat/quick-replies";
import { ScrollToBottomButton } from "../../../../components/chat/scroll-to-bottom-button";
import { ChatHeader } from "../../../../components/chat/chat-header";
import { ChatDotBackground } from "../../../../components/chat/chat-dot-background";
import { ErrorBanner } from "../../../../components/ui/error-banner";
import { useChatBlockToggle, useReportChat } from "../../../../src/hooks/use-chat";
import { useChatConversation } from "../../../../src/hooks/use-chat-conversation";
import { useLiveChatKeys } from "../../../../src/hooks/use-live-chat-keys";
import { useBlockedUsers } from "../../../../src/hooks/use-moderation";
import { useThemeColors } from "../../../../src/hooks/use-theme-colors";
import {
  CHAT_QUICK_REPLIES,
  chatAuthorLabel,
  chatReadOnlyCopy,
  type ChatTimelineItem,
} from "../../../../src/lib/chat-format";
import { friendlyErrorMessage } from "../../../../src/lib/error-messages";


/** Distancia al final (en altura de la lista) a partir de la cual aparece "Ir al último mensaje". */
const SCROLL_AWAY_FALLBACK_PX = 600;

const OPEN_ERROR = "No pudimos abrir el chat. Intentá de nuevo en unos minutos.";

/** MOVO-284 (ADR-040): conversación del envío entre emisor, receptor y transportista. */
export default function ShipmentChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useThemeColors();
  // "Al frente" = pantalla enfocada Y app activa: con el celu bloqueado el socket puede seguir vivo un rato y no
  // alcanza con mirar la navegación.
  const screenFocused = useIsFocused();
  const [appActive, setAppActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => setAppActive(next === "active"));
    return () => sub.remove();
  }, []);
  const chat = useChatConversation(id, { focused: screenFocused && appActive });

  const reportMutation = useReportChat(id ?? "");
  const blockedQuery = useBlockedUsers();
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [safetyError, setSafetyError] = useState<string | null>(null);
  const toggleBlock = useChatBlockToggle({
    onError: (error) => setSafetyError(friendlyErrorMessage(error, "No pudimos actualizar el bloqueo. Intentá de nuevo.")),
  });

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(app)/(tabs)/home" as never);
  }, []);

  // Se vuelve al detalle que ya está en la pila (el chat se abre desde ahí); si no está, lo abre. Con `push` cada
  // ida y vuelta apilaría otra copia.
  const openShipmentDetail = useCallback(() => {
    if (id) router.dismissTo(`/(app)/shipments/${id}` as never);
  }, [id]);

  // ── Animación de lo que llega en vivo y botón "Ir al último mensaje".
  const listRef = useRef<FlatList<ChatTimelineItem>>(null);
  const listHeightRef = useRef(SCROLL_AWAY_FALLBACK_PX);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const awayRef = useRef(false);
  const [newWhileAway, setNewWhileAway] = useState(0);
  const { liveKeys, arrivals } = useLiveChatKeys(chat.timeline, !chat.isLoading);

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
      // Solo el mensaje que acaba de enviar ESTE teléfono (todavía local) baja al final. Uno propio que llega por otro
      // dispositivo, o dentro de una carga en bloque, cuenta como nuevo igual que uno ajeno.
      if (item.message.localState === "sending") scrollToBottom();
      else incoming += 1;
    }
    if (incoming > 0 && awayRef.current) setNewWhileAway((count) => count + incoming);
  }, [arrivals, scrollToBottom]);

  const participantById = new Map(chat.participants.map((p) => [p.userId, p]));
  const blockedIds = new Set((blockedQuery.data ?? []).map((u) => u.id));
  const safetyTargets: SafetyTarget[] = chat.participants
    .filter((p) => p.userId !== chat.meId)
    .map((p) => ({ userId: p.userId, name: p.firstName, blocked: blockedIds.has(p.userId) }));

  const renderItem = ({ item }: { item: ChatTimelineItem }) => {
    if (item.kind === "day") {
      return (
        <View className="items-center" style={{ marginTop: 6, marginBottom: 6 }}>
          <Text className="font-sans-medium text-caption uppercase text-fg-3">{item.label}</Text>
        </View>
      );
    }
    if (item.kind === "event") return <ChatEventCard card={item.card} testID={`chat-event-${item.card.id}`} />;
    const author = participantById.get(item.message.authorId);
    const authorLabel = item.mine
      ? undefined
      : chatAuthorLabel({
          authorId: item.message.authorId,
          authorName: item.message.authorName,
          participants: chat.participants,
          shipment: chat.shipment,
        });
    return (
      <ChatBubble
        testID={`chat-message-${item.message.clientMessageId || item.message.id}`}
        message={item.message}
        mine={item.mine}
        authorLabel={authorLabel}
        showName={item.showName}
        showAvatar={item.showAvatar}
        groupStart={item.groupStart}
        animateIn={liveKeys.has(item.key)}
        avatar={author ? { fullName: author.fullName, photoUrl: author.photoUrl } : undefined}
        onPressAvatar={openShipmentDetail}
        onRetry={chat.retry}
        onDiscard={chat.discard}
      />
    );
  };

  const errorMessage = chat.isError ? friendlyErrorMessage(chat.error, OPEN_ERROR, { VALIDATION_FAILED: OPEN_ERROR }) : null;

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <ChatHeader participants={chat.participants} onBack={goBack} onOptions={() => setSafetyOpen(true)} onPressParticipants={openShipmentDetail} />

      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View
          className="flex-1"
          style={{ marginTop: 10 }}
          onLayout={(event: LayoutChangeEvent) => {
            listHeightRef.current = event.nativeEvent.layout.height || SCROLL_AWAY_FALLBACK_PX;
          }}
        >
          <ChatDotBackground />
          {chat.isLoading ? (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator color={colors.fg1} />
            </View>
          ) : errorMessage ? (
            <View className="px-5 pt-4">
              <ErrorBanner testID="chat-error" message={errorMessage} />
              <Pressable testID="chat-retry" onPress={() => void chat.refetch()}>
                <Text className="font-sans-semibold text-small text-fg">Reintentar</Text>
              </Pressable>
            </View>
          ) : chat.isEmpty ? (
            <View testID="chat-empty" className="flex-1 items-center justify-center" style={{ gap: 18, padding: 24 }}>
              {/* `timeline` viene del más nuevo al más viejo (la lista va invertida): acá se muestra al derecho. */}
              {[...chat.timeline].reverse().map((item) =>
                item.kind === "event" ? <ChatEventCard key={item.key} card={item.card} testID={`chat-event-${item.card.id}`} /> : null,
              )}
              <View className="border border-border bg-bg" style={{ borderRadius: 14, padding: 18, gap: 6 }}>
                <Text className="font-sans-semibold text-body text-fg">Coordinen acá</Text>
                <Text className="font-sans text-fg-2" style={{ fontSize: 13, lineHeight: 20 }}>
                  Lo ven el emisor, el transportista y el receptor. Se cierra 24 h después de finalizado el envío.
                </Text>
              </View>
            </View>
          ) : (
            <FlatList
              ref={listRef}
              testID="chat-list"
              inverted
              data={chat.timeline}
              keyExtractor={(item) => item.key}
              renderItem={renderItem}
              contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 8, paddingBottom: 12 }}
              onScroll={handleScroll}
              scrollEventThrottle={64}
              onEndReached={chat.loadOlder}
              onEndReachedThreshold={0.4}
              keyboardShouldPersistTaps="handled"
              ListFooterComponent={chat.isLoadingOlder ? <ActivityIndicator className="my-3" color={colors.fg3} /> : null}
            />
          )}
          <ScrollToBottomButton visible={awayFromBottom} newCount={newWhileAway} onPress={scrollToBottom} />
        </View>

        <ModerationBanner visible={chat.moderationWarning} onDismiss={chat.dismissModerationWarning} />
        {chat.sendError ? (
          <View className="px-4">
            <ErrorBanner testID="chat-send-error" message={friendlyErrorMessage(chat.sendError, "No pudimos enviar el mensaje.")} />
          </View>
        ) : null}

        {!chat.isLoading && !errorMessage && chat.canWrite && chat.myRole ? (
          <QuickReplies testID="chat-quick-replies" replies={CHAT_QUICK_REPLIES[chat.myRole]} onPick={(text) => chat.send(text)} />
        ) : null}
        {!chat.isLoading && !errorMessage ? (
          <ChatComposer
            testID="chat-composer"
            canWrite={chat.canWrite}
            readOnlyCopy={chatReadOnlyCopy({ archived: chat.archived, status: chat.shipment?.status, isFormerReceiver: chat.isFormerReceiver })}
            onSend={chat.send}
          />
        ) : null}
      </KeyboardAvoidingView>

      <ChatSafetySheet
        visible={safetyOpen}
        onClose={() => {
          setSafetyOpen(false);
          setSafetyError(null);
        }}
        targets={safetyTargets}
        reported={chat.reportedByMe || reportMutation.isSuccess}
        busy={toggleBlock.isPending || reportMutation.isPending}
        error={safetyError}
        onToggleBlock={(target) => {
          setSafetyError(null);
          toggleBlock.mutate({ userId: target.userId, block: !target.blocked });
        }}
        onReport={() => reportMutation.mutate()}
      />
    </SafeAreaView>
  );
}
