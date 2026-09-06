import { BlurView } from "expo-blur";
import { router } from "expo-router";
import { Package, X } from "lucide-react-native";
import { useColorScheme } from "nativewind";
import { useEffect } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useActiveTripMatchAlert } from "../../src/hooks/use-active-trip-match-alert";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

const AUTO_DISMISS_MS = 8_000;

/**
 * Aviso global de matches nuevos (MOVO-163, extensión de alcance "tipo Uber"): a
 * diferencia de todos los banners existentes del repo (`SuccessBanner`/`ErrorBanner`),
 * este tiene que verse sin importar en qué pantalla está el usuario — no es un
 * componente embebido en una screen, es un overlay montado una sola vez en
 * `app/(app)/_layout.tsx`, hermano superpuesto del `<Stack>`. Mismo lenguaje visual
 * "glassy" que `FloatingTabBar` (MOVO-78) en vez de un estilo nuevo.
 *
 * `Pressable` de cerrar anidado dentro del `Pressable` de todo el cuerpo (mismo
 * criterio que `TripCard`/`ContactRow`, MOVO-139/163): RN resuelve el touch al más
 * específico, así que tocar la X no dispara también la navegación.
 */
export function TripMatchAlertBanner() {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const { alert, dismiss } = useActiveTripMatchAlert();

  useEffect(() => {
    if (!alert) return;
    const timeout = setTimeout(dismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timeout);
  }, [alert, dismiss]);

  if (!alert) return null;

  const message =
    alert.newCount === 1
      ? "1 paquete nuevo compatible con tu viaje"
      : `${alert.newCount} paquetes nuevos compatibles con tu viaje`;

  return (
    <View pointerEvents="box-none" style={{ position: "absolute", top: insets.top + 8, left: 16, right: 16 }}>
      <View
        style={{
          borderRadius: 16,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: isDark ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.6)",
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: isDark ? 0.45 : 0.12,
          shadowRadius: 20,
          elevation: 12,
        }}
      >
        <BlurView
          intensity={isDark ? 45 : 70}
          tint={
            Platform.OS === "ios"
              ? isDark
                ? "systemUltraThinMaterialDark"
                : "systemUltraThinMaterialLight"
              : isDark
                ? "dark"
                : "light"
          }
          blurMethod={Platform.OS === "android" ? "dimezisBlurView" : "none"}
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        />
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: isDark ? "rgba(10,10,11,0.4)" : "rgba(255,255,255,0.45)",
          }}
        />
        <Pressable
          testID="trip-match-alert-banner"
          onPress={() => {
            dismiss();
            router.push({ pathname: "/(app)/(tabs)/transport", params: { tripId: alert.tripId } });
          }}
          className="flex-row items-center gap-3 px-4 py-3"
        >
          <View className="h-9 w-9 items-center justify-center rounded-full bg-lime-200">
            <Package size={18} color={colors.fg1} strokeWidth={1.8} />
          </View>
          <Text className="flex-1 font-sans-medium text-small text-fg" numberOfLines={2}>
            {message}
          </Text>
          <Pressable testID="trip-match-alert-dismiss" onPress={dismiss} hitSlop={8}>
            <X size={16} color={colors.fg3} strokeWidth={1.8} />
          </Pressable>
        </Pressable>
      </View>
    </View>
  );
}
