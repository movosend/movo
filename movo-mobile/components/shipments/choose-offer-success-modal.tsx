import * as Haptics from "expo-haptics";
import { CheckCircle2 } from "lucide-react-native";
import { useEffect } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { SafeAreaProvider, SafeAreaView, initialWindowMetrics } from "react-native-safe-area-context";
import { useSheetAnimation } from "../../src/hooks/use-sheet-animation";

const FALLBACK_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

export interface ChooseOfferSuccessModalProps {
  visible: boolean;
  carrierName: string | null;
  onDismiss: () => void;
  testID?: string;
}

/**
 * Modal de éxito con animación al elegir oferta (MOVO-150 / MOVO-244).
 * Presenta confirmación háptica, barra de progreso y auto-redirección al detalle
 * del envío tras completarse la animación (~1.5s), con opción de tocar para avanzar antes.
 */
export function ChooseOfferSuccessModal({
  visible,
  carrierName,
  onDismiss,
  testID,
}: ChooseOfferSuccessModalProps) {
  const { isMounted, backdropStyle, sheetStyle } = useSheetAnimation(visible);
  const progress = useSharedValue(0);

  const displayName = carrierName || "el transportista";

  useEffect(() => {
    if (visible) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      progress.value = 0;
      progress.value = withTiming(1, { duration: 1500 });
      const timer = setTimeout(() => {
        onDismiss();
      }, 1600);
      return () => clearTimeout(timer);
    } else {
      progress.value = 0;
    }
  }, [visible, onDismiss, progress]);

  const progressBarStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%`,
  }));

  return (
    <Modal
      visible={isMounted}
      animationType="none"
      transparent
      onRequestClose={onDismiss}
      testID={testID ?? "choose-offer-success-modal"}
    >
      <SafeAreaProvider initialMetrics={initialWindowMetrics ?? FALLBACK_METRICS}>
        <View className="flex-1">
          {/* Overlay fade */}
          <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
            <Pressable
              testID={testID ? `${testID}-backdrop` : "choose-offer-success-backdrop"}
              onPress={onDismiss}
              className="flex-1 bg-black/50"
            />
          </Animated.View>

          {/* Sheet container */}
          <View pointerEvents="box-none" className="flex-1 justify-end">
            <Animated.View
              style={sheetStyle}
              className="rounded-t-[24px] border-t border-border bg-bg px-5 pt-6 pb-2"
            >
              <SafeAreaView edges={["bottom"]} className="gap-5 items-center">
                <View className="h-16 w-16 items-center justify-center rounded-full bg-success-100">
                  <CheckCircle2 size={36} color="#16754A" strokeWidth={2.4} />
                </View>

                <View className="gap-2 items-center text-center">
                  <Text className="font-sans-semibold text-h2 text-fg text-center">
                    ¡Oferta aceptada!
                  </Text>
                  <Text className="font-sans text-small leading-5 text-fg-2 text-center px-4">
                    Seleccionaste la propuesta de{" "}
                    <Text className="font-sans-semibold text-fg">{displayName}</Text>.
                    Tu envío quedó en espera de la confirmación del pago para iniciar el viaje.
                  </Text>
                </View>

                {/* Animated progress redirect bar */}
                <View className="w-full gap-2 px-2 items-center">
                  <View className="h-1.5 w-full overflow-hidden rounded-full bg-border">
                    <Animated.View
                      style={progressBarStyle}
                      className="h-full rounded-full bg-lime-500"
                    />
                  </View>
                  <Text className="font-sans text-[12px] text-fg-3">
                    Redirigiendo al detalle del envío...
                  </Text>
                </View>

                <View className="w-full pt-1">
                  <Pressable
                    testID={testID ? `${testID}-dismiss-btn` : "choose-offer-success-dismiss-button"}
                    onPress={onDismiss}
                    className="h-12 w-full items-center justify-center rounded-[12px] bg-lime-500 active:bg-lime-400"
                  >
                    <Text className="font-sans-semibold text-small text-ink-950">
                      Ver detalle del envío
                    </Text>
                  </Pressable>
                </View>
              </SafeAreaView>
            </Animated.View>
          </View>
        </View>
      </SafeAreaProvider>
    </Modal>
  );
}
