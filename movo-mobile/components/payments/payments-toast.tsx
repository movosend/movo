import { Check } from "lucide-react-native";
import { useEffect } from "react";
import { Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);
export const PAYMENTS_TOAST_DURATION_MS = 2600;

/**
 * Aviso flotante de "Pagos y cobros" (MOVO-101), fiel al toast del prototipo: pill oscura
 * con check lima arriba de la pantalla, que entra desde arriba y se va sola. Es local: el
 * repo no usa librería de toasts (ver `movo-mobile/CLAUDE.md`). `message` es la key: un
 * mensaje nuevo vuelve a animar la entrada.
 */
export function PaymentsToast({ message, onHide }: { message: string; onHide: () => void }) {
  const insets = useSafeAreaInsets();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = 0;
    progress.value = withTiming(1, { duration: 260, easing: EASE_OUT });
    const timer = setTimeout(onHide, PAYMENTS_TOAST_DURATION_MS);
    return () => clearTimeout(timer);
    // `progress` es un shared value: estable en runtime (ver MOVO-244 sobre el mock de Jest).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message, onHide]);

  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * -8 }],
  }));

  return (
    <Animated.View
      testID="payments-toast"
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          left: 16,
          right: 16,
          top: insets.top + 7,
          borderRadius: 14,
          backgroundColor: "rgba(10,10,11,0.92)",
          paddingHorizontal: 14,
          paddingVertical: 12,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          shadowColor: "#0A0A0B",
          shadowOpacity: 0.2,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 10 },
          elevation: 8,
        },
        style,
      ]}
    >
      <View className="h-5 w-5 items-center justify-center rounded-full bg-lime-500">
        <Check size={12} color="#0A0A0B" strokeWidth={3} />
      </View>
      <Text className="flex-1 font-sans-medium text-[13.5px] text-white">{message}</Text>
    </Animated.View>
  );
}
