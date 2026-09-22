import { router, useFocusEffect } from "expo-router";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { NotificationCategoryRow } from "../../../../components/notifications/notification-category-row";
import { NotificationPermissionBanner } from "../../../../components/notifications/notification-permission-banner";
import { ErrorBanner } from "../../../../components/ui/error-banner";
import { ToggleSwitch } from "../../../../components/ui/toggle-switch";
import {
  useNotificationPreferences,
  useUpdateNotificationPreferences,
} from "../../../../src/hooks/use-notification-preferences";
import { useThemeColors } from "../../../../src/hooks/use-theme-colors";
import { friendlyErrorMessage } from "../../../../src/lib/error-messages";
import {
  activeCategoriesLabel,
  groupCategoriesBySection,
  isCategoryEnabled,
  quietHoursSummaryLabel,
} from "../../../../src/lib/notification-settings-format";
import { getNotificationPermissionStatus } from "../../../../src/lib/notification-permission";

/**
 * Hub "Notificaciones" (MOVO-246), basado en el prototipo de Claude Design
 * "Control de notificaciones en settings" (`Notificaciones.dc.html`) — el layout y
 * el lenguaje visual salen del prototipo, los datos salen del catálogo real de
 * MOVO-245 (`@movo/shared`), que no coincide con las 12 filas ficticias que trae el
 * `.dc.html`. Ver la entrada de MOVO-246 en `movo-mobile/CLAUDE.md` para el detalle
 * completo de qué difiere y por qué (toggle maestro agregado sobre el prototipo,
 * sin canal "app", sin el punto "live"/banners `critical` que no existen en el tipo
 * real).
 *
 * Mismo patrón hub que `security.tsx`/`legal/index.tsx`: cada categoría y el
 * horario de silencio son rutas propias, no contenido inline.
 */
export default function NotificationsHubScreen() {
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

  const sections = groupCategoriesBySection();

  function handleMutationError(err: unknown) {
    setBanner(friendlyErrorMessage(err, "No pudimos guardar el cambio. Intentá de nuevo."));
  }

  function togglePush(next: boolean) {
    setBanner(null);
    updatePreferences.mutate({ pushEnabled: next }, { onError: handleMutationError });
  }

  function toggleCategory(id: string, next: boolean) {
    setBanner(null);
    updatePreferences.mutate({ categories: { [id]: next } }, { onError: handleMutationError });
  }

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <View className="flex-row items-center justify-between gap-3 px-5 pb-3.5 pt-1.5">
        <View className="flex-row items-center gap-3">
          <Pressable
            testID="notifications-hub-back"
            onPress={() => router.back()}
            className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
          >
            <ChevronLeft size={18} color={colors.fg1} strokeWidth={2} />
          </Pressable>
          <Text className="font-sans-semibold text-h3 text-fg">Notificaciones</Text>
        </View>
        {prefs ? (
          <Text testID="notifications-hub-active-count" className="font-mono text-[11px] text-fg-3">
            {activeCategoriesLabel(prefs.categories)}
          </Text>
        ) : null}
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.fg1} testID="notifications-hub-loading" />
        </View>
      ) : isError || !prefs ? (
        <View className="flex-1 items-center justify-center px-5">
          <Text testID="notifications-hub-error" className="text-center font-sans text-body text-fg-3">
            No pudimos cargar tus preferencias de notificación.
          </Text>
        </View>
      ) : (
        <ScrollView
          testID="notifications-hub-content"
          contentContainerClassName="px-5 pb-12"
          showsVerticalScrollIndicator={false}
        >
          <ErrorBanner testID="notifications-hub-banner" message={banner} />

          {permissionBlocked ? (
            <NotificationPermissionBanner testID="notifications-hub-permission-banner" />
          ) : (
            <View testID="notifications-hub-settings">
              <Text testID="notifications-hub-intro" className="mb-6 font-sans text-small leading-[19px] text-fg-3">
                Elegí qué te avisamos y cómo. Podés prender o apagar categorías enteras, definir un horario de
                silencio, y desactivar todo de una con el interruptor de arriba.
              </Text>

              <View className="mb-9 rounded-[10px] border border-border">
                <View className="flex-row items-center gap-3.5 p-4">
                  <View className="flex-1">
                    <Text className="font-sans-medium text-body text-fg">Notificaciones push</Text>
                    <Text className="mt-0.5 font-sans text-small text-fg-3">
                      {prefs.pushEnabled ? "Activadas" : "Desactivadas — ninguna categoría te va a avisar"}
                    </Text>
                  </View>
                  <ToggleSwitch
                    testID="notifications-hub-master-toggle"
                    value={prefs.pushEnabled}
                    onChange={togglePush}
                  />
                </View>

                <View className="h-px bg-border" />

                <Pressable
                  testID="notifications-hub-quiet-hours"
                  onPress={() => router.push("/profile/notifications/quiet-hours" as any)}
                  className="flex-row items-center gap-3.5 p-4"
                >
                  <View className="flex-1">
                    <Text className="font-sans-medium text-body text-fg">Horario de silencio</Text>
                    <Text
                      testID="notifications-hub-quiet-hours-summary"
                      className="mt-0.5 font-sans text-small text-fg-3"
                    >
                      {quietHoursSummaryLabel(prefs.quietHours)}
                    </Text>
                  </View>
                  <ChevronRight size={18} strokeWidth={1.8} color={colors.fg3} />
                </Pressable>
              </View>

              {sections.map((section) => (
                <View key={section.section} className="mb-9">
                  <Text className="mb-3 font-sans-semibold text-h3 text-fg">{section.title}</Text>
                  <View className="px-4">
                    {section.categories.map((category) => (
                      <NotificationCategoryRow
                        key={category.id}
                        testID={`notifications-hub-row-${category.id}`}
                        title={category.title}
                        sub={category.sub}
                        implemented={category.implemented}
                        enabled={isCategoryEnabled(prefs.categories, category.id)}
                        dimmed={!prefs.pushEnabled}
                        permissionBlocked={false}
                        onToggle={(next) => toggleCategory(category.id, next)}
                        onPress={() => router.push(`/profile/notifications/${category.id}` as any)}
                      />
                    ))}
                  </View>
                </View>
              ))}

              <Text className="mt-3 font-sans text-[11px] leading-[16px] text-fg-3">
                Los avisos marcados <Text className="font-sans-semibold text-fg-2">Pronto</Text> todavía no
                están disponibles. Te van a llegar en cuanto se habiliten, con la configuración que dejes acá.
              </Text>
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
