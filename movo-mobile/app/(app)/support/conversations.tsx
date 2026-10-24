import { router, useFocusEffect } from "expo-router";
import { ChevronLeft, MessageCircle } from "lucide-react-native";
import { useCallback } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SupportListRow } from "../../../components/support/support-list-row";
import { ErrorBanner } from "../../../components/ui/error-banner";
import { SkeletonBlock } from "../../../components/ui/skeleton-block";
import { useSupportList } from "../../../src/hooks/use-support";
import { useThemeColors } from "../../../src/hooks/use-theme-colors";
import { friendlyErrorMessage } from "../../../src/lib/error-messages";
import { pushOnce } from "../../../src/lib/navigation-guard";

const LIST_ERROR = "No pudimos cargar tus consultas. Intentá de nuevo en unos minutos.";
// Contra un backend que todavía no tiene el endpoint la ruta cae en otra y vuelve como VALIDATION_FAILED/NOT_FOUND,
// textos que no tienen nada que ver con lo que pasó.
const LIST_ERROR_OVERRIDES = { VALIDATION_FAILED: LIST_ERROR, NOT_FOUND: LIST_ERROR } as const;

/** MOVO-324: "Mis consultas" de soporte. Mismo esqueleto que la lista de chats (`chats.tsx`). */
export default function SupportConversationsScreen() {
  const colors = useThemeColors();
  const { data, isLoading, isError, error, refetch, isRefetching } = useSupportList();

  // La lista se refresca al enfocar: al volver de una conversación el contador y el estado ya cambiaron.
  useFocusEffect(
    useCallback(() => {
      void refetch();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(app)/(tabs)/home" as never);
  };

  const items = data ?? [];

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <View className="flex-row items-center gap-3 px-4 pb-2 pt-2">
        <Pressable testID="support-back" accessibilityLabel="Volver" onPress={goBack} className="h-9 w-9 items-center justify-center rounded-full bg-bg-mute">
          <ChevronLeft size={18} color={colors.fg1} strokeWidth={2} />
        </Pressable>
      </View>
      <Text className="font-sans-semibold text-title text-fg" style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 }}>
        Soporte
      </Text>
      <Text className="font-sans text-small text-fg-3" style={{ paddingHorizontal: 20, paddingBottom: 14 }}>
        El equipo de Movo te responde por acá.
      </Text>

      <View className="flex-1">
        {isLoading ? (
          <View testID="support-loading" className="px-4" style={{ gap: 10 }}>
            {[0, 1, 2].map((index) => (
              <SkeletonBlock key={index} style={{ height: 96, borderRadius: 14 }} />
            ))}
          </View>
        ) : isError ? (
          <View className="px-5">
            <ErrorBanner testID="support-error" message={friendlyErrorMessage(error, LIST_ERROR, LIST_ERROR_OVERRIDES)} />
            <Pressable testID="support-retry" onPress={() => void refetch()}>
              <Text className="font-sans-semibold text-small text-fg">Reintentar</Text>
            </Pressable>
          </View>
        ) : (
          <FlatList
            testID="support-conversations"
            data={items}
            contentContainerStyle={{ paddingHorizontal: 14, gap: 10, paddingBottom: 24, flexGrow: items.length === 0 ? 1 : undefined }}
            keyExtractor={(item) => item.id}
            ListHeaderComponent={
              items.length > 0 ? (
                <Text className="font-sans-semibold text-caption uppercase text-fg-3" style={{ paddingHorizontal: 6, paddingBottom: 4 }}>
                  Mis consultas
                </Text>
              ) : null
            }
            refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
            renderItem={({ item }) => (
              <SupportListRow testID={`support-row-${item.id}`} item={item} onPress={() => pushOnce(`/support/${item.id}`)} />
            )}
            ListEmptyComponent={
              <View testID="support-empty" className="items-center gap-2 px-8 pt-24">
                <MessageCircle size={32} color={colors.fg3} strokeWidth={1.8} />
                <Text className="font-sans-semibold text-h3 text-fg">Todavía no hiciste ninguna consulta</Text>
                <Text className="text-center font-sans text-small text-fg-2">
                  Si tenés un problema con un envío, un pago o tu cuenta, escribí y te contestan por acá.
                </Text>
              </View>
            }
          />
        )}
      </View>

      <View className="px-4 pb-3 pt-2">
        <Pressable
          testID="support-new"
          onPress={() => pushOnce("/support/new")}
          accessibilityRole="button"
          className="w-full flex-row items-center justify-center rounded-lg bg-fg py-3.5"
        >
          <Text className="font-sans-semibold text-body text-bg">Nueva consulta</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
