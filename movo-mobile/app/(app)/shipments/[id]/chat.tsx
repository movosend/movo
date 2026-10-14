import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ChatBubble } from "../../../../components/chat/chat-bubble";
import { ChatComposer } from "../../../../components/chat/chat-composer";
import { ChatEventCard } from "../../../../components/chat/chat-event-card";
import { ChatSafetySheet, type SafetyTarget } from "../../../../components/chat/chat-safety-sheet";
import { ModerationBanner } from "../../../../components/chat/moderation-banner";
import { QuickReplies } from "../../../../components/chat/quick-replies";
import { ChatHeader } from "../../../../components/chat/chat-header";
import { ChatDotBackground } from "../../../../components/chat/chat-dot-background";
import { ErrorBanner } from "../../../../components/ui/error-banner";
import { useChatBlockToggle, useReportChat } from "../../../../src/hooks/use-chat";
import { useChatConversation } from "../../../../src/hooks/use-chat-conversation";
import { useBlockedUsers } from "../../../../src/hooks/use-moderation";
import { useThemeColors } from "../../../../src/hooks/use-theme-colors";
import {
  CHAT_QUICK_REPLIES,
  chatReadOnlyCopy,
  chatRoleLabel,
  shortName,
  type ChatTimelineItem,
} from "../../../../src/lib/chat-format";
import { friendlyErrorMessage } from "../../../../src/lib/error-messages";


const OPEN_ERROR = "No pudimos abrir el chat. Intentá de nuevo en unos minutos.";

/** MOVO-284 (ADR-040): conversación del envío entre emisor, receptor y transportista. */
export default function ShipmentChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useThemeColors();
  const chat = useChatConversation(id);
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
      : author
        ? `${shortName(author.fullName)} · ${chatRoleLabel(author.role)}`
        : (item.message.authorName ?? undefined);
    return (
      <ChatBubble
        testID={`chat-message-${item.message.clientMessageId || item.message.id}`}
        message={item.message}
        mine={item.mine}
        authorLabel={authorLabel}
        showName={item.showName}
        showAvatar={item.showAvatar}
        groupStart={item.groupStart}
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
        <View className="flex-1" style={{ marginTop: 10 }}>
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
              testID="chat-list"
              inverted
              data={chat.timeline}
              keyExtractor={(item) => item.key}
              renderItem={renderItem}
              contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 8, paddingBottom: 12 }}
              onEndReached={chat.loadOlder}
              onEndReachedThreshold={0.4}
              keyboardShouldPersistTaps="handled"
              ListFooterComponent={chat.isLoadingOlder ? <ActivityIndicator className="my-3" color={colors.fg3} /> : null}
            />
          )}
        </View>

        <ModerationBanner visible={chat.moderationWarning} onDismiss={chat.dismissModerationWarning} />
        {chat.sendError ? (
          <View className="px-4">
            <ErrorBanner testID="chat-send-error" message={friendlyErrorMessage(chat.sendError, "No pudimos enviar el mensaje.")} />
          </View>
        ) : null}

        {chat.canWrite && chat.myRole ? (
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
