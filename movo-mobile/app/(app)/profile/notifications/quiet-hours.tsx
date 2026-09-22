import { router } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ErrorBanner } from "../../../../components/ui/error-banner";
import { SelectField } from "../../../../components/ui/select-field";
import { ToggleSwitch } from "../../../../components/ui/toggle-switch";
import {
  useNotificationPreferences,
  useUpdateNotificationPreferences,
} from "../../../../src/hooks/use-notification-preferences";
import { useThemeColors } from "../../../../src/hooks/use-theme-colors";
import { friendlyErrorMessage } from "../../../../src/lib/error-messages";

/**
 * Franja nocturna típica (el backend acepta cualquier `HH:MM` válido, pero acotar
 * las opciones a una franja nocturna razonable evita una lista de 48 medias horas
 * para un caso de uso que casi siempre cae de noche a la mañana).
 *
 * Reemplaza el tap-to-cycle original del prototipo `Notificaciones.dc.html`
 * (tocar la card entera avanzaba al siguiente valor a ciegas, sin mostrar las
 * demás opciones) — feedback de usuario: "no se entiende cómo usarlos". Ahora es
 * un `SelectField` (mismo picker con hoja inferior que ya usa el resto de la app,
 * ej. `TripForm`), que muestra la lista completa y cuál está elegida.
 */
const HOURS: readonly string[] = ["20:00", "21:00", "22:00", "23:00", "00:00", "01:00"];
const HOURS_END: readonly string[] = ["06:00", "07:00", "08:00", "09:00", "10:00"];

/**
 * "Horario de silencio" (MOVO-246 AC5): activar/desactivar + elegir Desde/Hasta de
 * una lista fija, cada cambio persiste solo (mismo criterio "todo se guarda sin
 * botón Guardar" que `edit.tsx`, MOVO-135) — sin excepciones activas hoy (ninguna
 * categoría implementada es `quietHoursExempt` todavía), así que el callout de
 * abajo es copy genérico, no promete un caso concreto que todavía no pasa.
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

  function setFrom(value: string) {
    setBanner(null);
    updatePreferences.mutate({ quietHours: { from: value } }, { onError: handleError });
  }

  function setTo(value: string) {
    setBanner(null);
    updatePreferences.mutate({ quietHours: { to: value } }, { onError: handleError });
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
            <SelectField
              testID="quiet-hours-from"
              label="Desde"
              value={prefs.quietHours.from}
              options={HOURS}
              onChange={setFrom}
              containerClassName="flex-1 gap-1.5"
            />
            <SelectField
              testID="quiet-hours-to"
              label="Hasta"
              value={prefs.quietHours.to}
              options={HOURS_END}
              onChange={setTo}
              containerClassName="flex-1 gap-1.5"
            />
          </View>

          <View className="mt-6 rounded-[10px] border border-border-strong bg-ink-950 p-4 dark:bg-ink-800">
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
