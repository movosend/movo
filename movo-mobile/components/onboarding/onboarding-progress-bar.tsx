import { ChevronLeft } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

const SEGMENT_COUNT = 5;

interface OnboardingProgressBarProps {
  step: number;
  showBack: boolean;
  showSkip: boolean;
  isDark: boolean;
  onBack: () => void;
  onSkip: () => void;
}

/**
 * Fila superior del carrusel (MOVO-249): back opcional + 5 segmentos (uno por paso
 * 0-4, el paso final "Listo" no tiene segmento propio — mismo criterio que el
 * prototipo, `showProgress: step<=4`) + "Omitir" opcional. `isDark` invierte los
 * colores fijos (no theme-aware — la pantalla decide su propio fondo por paso, ver
 * `app/onboarding.tsx`), igual que `screenBg`/`sbColor` del prototipo.
 */
export function OnboardingProgressBar({
  step,
  showBack,
  showSkip,
  isDark,
  onBack,
  onSkip,
}: OnboardingProgressBarProps) {
  const trackColor = isDark ? "rgba(255,255,255,0.16)" : "rgba(10,10,11,0.1)";
  const fillColor = isDark ? "#FFFFFF" : "#0A0A0B";
  const iconColor = isDark ? "#FFFFFF" : "#0A0A0B";
  const backBgClass = isDark ? "bg-ink-800" : "bg-ink-100";

  return (
    <View className="h-10 flex-row items-center gap-3 px-4">
      {showBack ? (
        <Pressable
          testID="onboarding-back"
          onPress={onBack}
          hitSlop={8}
          className={`h-10 w-10 items-center justify-center rounded-full ${backBgClass}`}
        >
          <ChevronLeft size={20} color={iconColor} strokeWidth={2} />
        </Pressable>
      ) : (
        <View className="h-10 w-10" />
      )}

      <View className="flex-1 flex-row gap-1.5 px-1">
        {Array.from({ length: SEGMENT_COUNT }).map((_, i) => (
          <View
            key={i}
            style={{ backgroundColor: trackColor }}
            className="h-1 flex-1 overflow-hidden rounded-full"
          >
            {i <= step ? (
              <View style={{ backgroundColor: fillColor, width: "100%", height: "100%" }} />
            ) : null}
          </View>
        ))}
      </View>

      {showSkip ? (
        <Pressable testID="onboarding-skip" onPress={onSkip} hitSlop={8} className="h-10 justify-center px-1">
          <Text className={`font-sans-medium text-body ${isDark ? "text-ink-300" : "text-fg-2"}`}>
            Omitir
          </Text>
        </Pressable>
      ) : (
        <View className="h-10 w-10" />
      )}
    </View>
  );
}
