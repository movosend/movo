import { Check } from "lucide-react-native";
import { useEffect, useRef } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { FadeInDown, FadeOutDown } from "react-native-reanimated";

const AUTO_DISMISS_MS = 3000;

interface SuccessToastProps {
  message: string | null;
  onDismiss?: () => void;
  /** `0` desactiva el auto-ocultado. */
  autoDismissMs?: number;
  testID?: string;
}

/**
 * Confirmación flotante: píldora oscura con el check en lima que entra desde abajo y se va sola. A diferencia de
 * `SuccessBanner`, no ocupa lugar en el layout: el banner en flujo empujaba la lista al aparecer y la subía de
 * golpe al irse a los 3 s, y quedaba pegado al texto de arriba (feedback de TestFlight en "Mis viajes").
 * El caller la posiciona (en general, sobre la barra de acción del pie). Tocarla la cierra.
 */
export function SuccessToast({
  message,
  onDismiss,
  autoDismissMs = AUTO_DISMISS_MS,
  testID,
}: SuccessToastProps) {
  // `onDismiss` en un ref: el caller suele pasar una arrow inline, y depender de ella reiniciaba el timer en cada
  // render del padre (con refetches seguidos, el aviso no se cerraba nunca solo).
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const canDismiss = onDismiss !== undefined;
  useEffect(() => {
    if (!message || autoDismissMs <= 0 || !canDismiss) return;
    const timer = setTimeout(() => onDismissRef.current?.(), autoDismissMs);
    return () => clearTimeout(timer);
  }, [message, autoDismissMs, canDismiss]);

  if (!message) return null;

  return (
    <Animated.View
      entering={FadeInDown.springify().damping(18)}
      exiting={FadeOutDown.duration(180)}
    >
      <Pressable
        testID={testID}
        onPress={onDismiss}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        className="flex-row items-center gap-3 self-center rounded-[22px] bg-ink-950 py-2.5 pl-2.5 pr-5 dark:border dark:border-ink-700 dark:bg-ink-800"
        style={{
          shadowColor: "#0A0A0B",
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: 0.22,
          shadowRadius: 16,
          elevation: 8,
        }}
      >
        <View className="h-7 w-7 items-center justify-center rounded-full bg-lime-500">
          <Check size={16} strokeWidth={2.6} color="#0A0A0B" />
        </View>
        <Text className="shrink font-sans-medium text-[14px] leading-[19px] text-paper">
          {message}
        </Text>
      </Pressable>
    </Animated.View>
  );
}
