import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { NotificationPermissionBanner } from "../../../../components/notifications/notification-permission-banner";
import { ErrorBanner } from "../../../../components/ui/error-banner";
import { ToggleSwitch } from "../../../../components/ui/toggle-switch";
import {
  useNotificationPreferences,
  useUpdateNotificationPreferences,
} from "../../../../src/hooks/use-notification-preferences";
import { useThemeColors } from "../../../../src/hooks/use-theme-colors";
import { friendlyErrorMessage } from "../../../../src/lib/error-messages";
import { getNotificationPermissionStatus } from "../../../../src/lib/notification-permission";
import {
  getNotificationCategoryDefinition,
  isCategoryEnabled,
  triggersForCategory,
} from "../../../../src/lib/notification-settings-format";

/**
 * Detalle de una categoría de notificación (MOVO-246). El toggle de acá y el de la
 * fila del hub comparten la misma mutación/query key (`use-notification-preferences.ts`)
 * — cambiar uno deja al otro sincronizado sin refetch, `setQueryData` siembra el
 * `NotificationPreferences` completo que devuelve el PUT.
 */
export default function NotificationCategoryDetailScreen() {
  const { categoryId } = useLocalSearchParams<{ categoryId: string }>();
  const colors = useThemeColors();
  const { data: prefs, isLoading, isError } = useNotificationPreferences();
  const updatePreferences = useUpdateNotificationPreferences();
  const [permissionBlocked, setPermissionBlocked] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void getNotificationPermissionStatus().then((status) => {
        if (!cancelled) setPermissionBlocked(!status.granted);
      });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const category = categoryId ? getNotificationCategoryDefinition(categoryId) : undefined;
  const triggers = categoryId ? triggersForCategory(categoryId) : [];

  function togglePush(next: boolean) {
    if (!category) return;
    setBanner(null);
    updatePreferences.mutate(
      { categories: { [category.id]: next } },
      {
        onError: (err) => setBanner(friendlyErrorMessage(err, "No pudimos guardar el cambio. Intentá de nuevo.")),
      },
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <View className="flex-row items-center gap-3 px-5 pb-3.5 pt-1.5">
        <Pressable
          testID="notification-detail-back"
          onPress={() => router.back()}
          className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
        >
          <ChevronLeft size={18} color={colors.fg1} strokeWidth={2} />
        </Pressable>
        <Text className="font-sans-semibold text-h3 text-fg" numberOfLines={1}>
          {category?.title ?? "Notificación"}
        </Text>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.fg1} testID="notification-detail-loading" />
        </View>
      ) : isError || !prefs || !category ? (
        <View className="flex-1 items-center justify-center px-5">
          <Text testID="notification-detail-error" className="text-center font-sans text-body text-fg-3">
            No pudimos cargar esta categoría.
          </Text>
        </View>
      ) : (
        <ScrollView
          testID="notification-detail-content"
          contentContainerClassName="px-5 pb-12"
          showsVerticalScrollIndicator={false}
        >
          <ErrorBanner testID="notification-detail-banner" message={banner} />

          {permissionBlocked ? <NotificationPermissionBanner testID="notification-detail-permission-banner" /> : null}

          <Text className="mb-6 font-sans text-small text-fg-2">{category.sub}</Text>

          <View className="overflow-hidden rounded-[10px] border border-border">
            <View className="flex-row items-center gap-4 p-4">
              <View className="flex-1">
                <Text className="font-sans-medium text-body text-fg">Notificación push</Text>
                <Text className="mt-0.5 font-sans text-[11px] text-fg-3">
                  {!category.implemented
                    ? "Todavía no disponible"
                    : permissionBlocked
                      ? "Bloqueado por el sistema"
                      : "Suena y aparece en pantalla"}
                </Text>
              </View>
              <ToggleSwitch
                testID="notification-detail-toggle"
                value={category.implemented && isCategoryEnabled(prefs.categories, category.id)}
                onChange={togglePush}
                disabled={!category.implemented || permissionBlocked}
              />
            </View>
          </View>

          <Text className="mb-3 mt-8 font-sans-semibold text-caption uppercase text-fg">Qué avisos incluye</Text>

          {category.implemented ? (
            <View>
              {triggers.map((trigger, index) => (
                <View
                  key={`${trigger.title}-${index}`}
                  testID={`notification-detail-trigger-${index}`}
                  className="flex-row items-start gap-3 border-t border-border py-3.5"
                >
                  <View className="mt-1.5 h-[7px] w-[7px] rounded-full bg-lime-500" />
                  <View className="flex-1">
                    <Text className="font-sans-medium text-small text-fg">{trigger.title}</Text>
                    <Text className="mt-1 font-sans text-[11px] leading-[16px] text-fg-3">{trigger.body}</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <Text testID="notification-detail-pending-note" className="font-sans text-small text-fg-3">
              Todavía no está disponible. Te va a llegar en cuanto se habilite, con la configuración que dejes
              acá.
            </Text>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
