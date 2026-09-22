import { router } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ErrorBanner } from "../../../../components/ui/error-banner";
import { ToggleSwitch } from "../../../../components/ui/toggle-switch";
import {
  useNotificationPreferences,
  useUpdateNotificationPreferences,
} from "../../../../src/hooks/use-notification-preferences";
import { useThemeColors } from "../../../../src/hooks/use-theme-colors";
import { friendlyErrorMessage } from "../../../../src/lib/error-messages";

/**
 * Ciclos fijos de hora (tal cual el prototipo `Notificaciones.dc.html`, `HOURS`/
 * `HOURS_END`) — el backend acepta cualquier `HH:MM` válido, pero el ticket pide
 * "UI completa del prototipo" específicamente para esta pantalla: tocar la card
 * avanza al siguiente valor de una franja nocturna típica, sin abrir un selector de
 * 48 opciones.
 */
const HOURS: readonly string[] = ["20:00", "21:00", "22:00", "23:00", "00:00", "01:00"];
const HOURS_END: readonly string[] = ["06:00", "07:00", "08:00", "09:00", "10:00"];

function cycle(list: readonly string[], current: string): string {
  const index = list.indexOf(current);
  return list[(index + 1) % list.length] ?? list[0];
}

/**
 * "Horario de silencio" (MOVO-246 AC5): activar/desactivar + ciclar Desde/Hasta,
 * cada tap persiste solo (mismo criterio "todo se guarda sin botón Guardar" que
 * `edit.tsx`, MOVO-135) — sin excepciones activas hoy (ninguna categoría
 * implementada es `quietHoursExempt` todavía), así que el callout de abajo es
 * copy genérico, no promete un caso concreto que todavía no pasa.
 */
export default function QuietHoursScreen() {
  const colors = useThemeColors();
  const { data: prefs, isLoading, isError } = useNotificationPreferences();
  const updatePreferences = useUpdateNotificationPreferences();
  const [banner, setBanner] = useState<string | null>(null);

  function handleError(err: unknown) {
    setBanner(friendlyErrorMessage(err, "No pudimos guardar el horario de silencio. Intentá de nuevo."));
  }

  function toggleQuietHours(next: boolean) {
    setBanner(null);
    updatePreferences.mutate({ quietHours: { enabled: next } }, { onError: handleError });
  }

  function cycleFrom() {
    if (!prefs) return;
    setBanner(null);
    updatePreferences.mutate(
      { quietHours: { from: cycle(HOURS, prefs.quietHours.from) } },
      { onError: handleError },
    );
  }

  function cycleTo() {
    if (!prefs) return;
    setBanner(null);
    updatePreferences.mutate(
      { quietHours: { to: cycle(HOURS_END, prefs.quietHours.to) } },
      { onError: handleError },
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <View className="flex-row items-center gap-3 px-5 pb-3.5 pt-1.5">
        <Pressable
          testID="quiet-hours-back"
          onPress={() => router.back()}
          className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
        >
          <ChevronLeft size={18} color={colors.fg1} strokeWidth={2} />
        </Pressable>
        <Text className="font-sans-semibold text-h3 text-fg">Horario de silencio</Text>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.fg1} testID="quiet-hours-loading" />
        </View>
      ) : isError || !prefs ? (
        <View className="flex-1 items-center justify-center px-5">
          <Text testID="quiet-hours-error" className="text-center font-sans text-body text-fg-3">
            No pudimos cargar el horario de silencio.
          </Text>
        </View>
      ) : (
        <ScrollView
          testID="quiet-hours-content"
          contentContainerClassName="px-5 pb-12"
          showsVerticalScrollIndicator={false}
        >
          <ErrorBanner testID="quiet-hours-banner" message={banner} />

          <Text className="mb-6 font-sans text-small text-fg-2">
            En esa franja no suena nada. Los avisos siguen apareciendo en el centro de la app.
          </Text>

          <View className="flex-row items-center gap-4 rounded-[10px] border border-border p-4">
            <Text className="flex-1 font-sans-medium text-body text-fg">Activar horario de silencio</Text>
            <ToggleSwitch
              testID="quiet-hours-toggle"
              value={prefs.quietHours.enabled}
              onChange={toggleQuietHours}
            />
          </View>

          <View
            className="mt-4 flex-row gap-3"
            style={{ opacity: prefs.quietHours.enabled ? 1 : 0.4 }}
            pointerEvents={prefs.quietHours.enabled ? "auto" : "none"}
          >
            <Pressable
              testID="quiet-hours-from"
              onPress={cycleFrom}
              className="flex-1 rounded-[10px] border border-border p-4"
            >
              <Text className="font-sans-semibold text-caption uppercase text-fg-3">Desde</Text>
              <Text className="mt-1.5 font-mono-medium text-h3 text-fg">{prefs.quietHours.from}</Text>
            </Pressable>
            <Pressable
              testID="quiet-hours-to"
              onPress={cycleTo}
              className="flex-1 rounded-[10px] border border-border p-4"
            >
              <Text className="font-sans-semibold text-caption uppercase text-fg-3">Hasta</Text>
              <Text className="mt-1.5 font-mono-medium text-h3 text-fg">{prefs.quietHours.to}</Text>
            </Pressable>
          </View>

          <View className="mt-6 rounded-[10px] bg-ink-950 p-4">
            <Text className="font-sans-semibold text-caption uppercase text-lime-500">Excepción</Text>
            <Text className="mt-1.5 font-sans text-[11px] leading-[16px] text-ink-200">
              Las categorías marcadas como excepción de seguridad van a sonar igual, aunque actives el
              horario de silencio. Hoy ninguna lo es todavía.
            </Text>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
