import React from "react";
import { Navigation } from "lucide-react-native";
import { Alert, Pressable, Text } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { NavigationTarget, openNavigation } from "../../src/lib/navigation-deeplink";

interface NavigateButtonProps {
  target: NavigationTarget;
  testID?: string;
  className?: string;
}

/**
 * Botón "Navegar" de una parada (MOVO-237): delega la navegación turn-by-turn a Google
 * Maps/Waze/browser vía deep-link (`openNavigation`), sin costo de API para Movo.
 */
export function NavigateButton({ target, testID = "navigate-btn", className = "" }: NavigateButtonProps) {
  const colors = useThemeColors();
  return (
    <Pressable
      testID={testID}
      onPress={(e) => {
        e.stopPropagation?.();
        void openNavigation(target).then((opened) => {
          if (opened === null) {
            Alert.alert(
              "No pudimos abrir la navegación",
              "No se pudo abrir ninguna app de mapas para esta parada. Probá abrir la dirección manualmente.",
            );
          }
        });
      }}
      className={`h-12 flex-row items-center justify-center gap-2 rounded-lg border border-border bg-bg-mute active:opacity-80 ${className}`}
      accessibilityRole="button"
      accessibilityLabel="Navegar hasta esta parada"
    >
      <Navigation size={20} color={colors.fg1} strokeWidth={1.75} />
      <Text className="font-sans-medium text-[16px] text-fg">Navegar</Text>
    </Pressable>
  );
}
