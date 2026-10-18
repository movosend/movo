import { router } from "expo-router";
import { ChevronLeft, MessageCircle } from "lucide-react-native";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ChatListRow } from "../../components/chat/chat-list-row";
import { ErrorBanner } from "../../components/ui/error-banner";
import { useChatList } from "../../src/hooks/use-chat";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { friendlyErrorMessage } from "../../src/lib/error-messages";
import { pushOnce } from "../../src/lib/navigation-guard";
import { useAuthStore } from "../../src/store/auth-store";

const LIST_ERROR = "No pudimos cargar tus chats. Intentá de nuevo en unos minutos.";
// Si el backend todavía no tiene el endpoint, `/shipments/chats` cae en `/shipments/:id` y vuelve como
// VALIDATION_FAILED ("Revisá los datos ingresados"), un texto que no tiene nada que ver con lo que pasó.
const LIST_ERROR_OVERRIDES = { VALIDATION_FAILED: LIST_ERROR, NOT_FOUND: LIST_ERROR } as const;

/** MOVO-284: lista "Chats", uno por envío con transportista. */
export default function ChatsScreen() {
  const colors = useThemeColors();
  const meId = useAuthStore((s) => s.user?.userId);
  const { data, isLoading, isError, error, refetch, isRefetching } = useChatList();

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(app)/(tabs)/home" as never);
  };

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top"]}>
      <View className="flex-row items-center gap-3 px-4 pb-2 pt-2">
        <Pressable testID="chats-back" accessibilityLabel="Volver" onPress={goBack} className="h-9 w-9 items-center justify-center rounded-full bg-bg-mute">
          <ChevronLeft size={18} color={colors.fg1} strokeWidth={2} />
        </Pressable>
      </View>
      <Text className="font-sans-semibold text-title text-fg" style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 }}>Chats</Text>
      <Text className="font-sans text-small text-fg-3" style={{ paddingHorizontal: 20, paddingBottom: 14 }}>Uno por cada envío en curso</Text>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.fg1} />
        </View>
      ) : isError ? (
        <View className="px-5">
          <ErrorBanner testID="chats-error" message={friendlyErrorMessage(error, LIST_ERROR, LIST_ERROR_OVERRIDES)} />
          <Pressable testID="chats-retry" onPress={() => void refetch()}>
            <Text className="font-sans-semibold text-small text-fg">Reintentar</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          testID="chats-list"
          data={data ?? []}
          contentContainerStyle={{ paddingHorizontal: 14, gap: 10, paddingBottom: 24 }}
          keyExtractor={(item) => item.shipmentId}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
          renderItem={({ item }) => (
            <ChatListRow
              testID={`chat-row-${item.shipmentId}`}
              item={item}
              meId={meId}
              onPress={() => pushOnce(`/(app)/shipments/${item.shipmentId}/chat`)}
            />
          )}
          ListEmptyComponent={
            <View testID="chats-empty" className="items-center gap-2 px-8 pt-24">
              <MessageCircle size={32} color={colors.fg3} strokeWidth={1.8} />
              <Text className="font-sans-semibold text-h3 text-fg">Todavía no tenés chats</Text>
              <Text className="text-center font-sans text-small text-fg-2">
                Cuando un envío tenga transportista asignado, la conversación aparece acá.
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}
