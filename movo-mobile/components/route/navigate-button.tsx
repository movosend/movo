import React from "react";
import { Navigation } from "lucide-react-native";
import { Pressable, Text } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { NavigationTarget, openNavigation } from "../../src/lib/navigation-deeplink";

interface NavigateButtonProps {
  target: NavigationTarget;
  testID?: string;
}

/**
 * Botón "Navegar" de una parada (MOVO-237): delega la navegación turn-by-turn a Google
 * Maps/Waze/browser vía deep-link (`openNavigation`), sin costo de API para Movo.
 */
export function NavigateButton({ target, testID = "navigate-btn" }: NavigateButtonProps) {
  const colors = useThemeColors();
  return (
    <Pressable
      testID={testID}
      onPress={(e) => {
        e.stopPropagation?.();
        void openNavigation(target);
      }}
      className="h-11 flex-row items-center justify-center gap-1.5 rounded-[10px] border border-border bg-bg px-3 active:bg-bg-mute"
      accessibilityRole="button"
      accessibilityLabel="Navegar hasta esta parada"
    >
      <Navigation size={15} color={colors.fg2} />
      <Text className="font-sans-medium text-[13.5px] text-fg">Navegar</Text>
    </Pressable>
  );
}
