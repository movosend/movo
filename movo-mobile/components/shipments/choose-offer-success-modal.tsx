import { CheckCircle2 } from "lucide-react-native";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
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
 * Modal de éxito al elegir transportista (MOVO-150 / MOVO-17).
 * El copy es estrictamente honesto con la máquina de estados canónica: el envío pasa a
 * `assignment_pending`, NO a `assigned` (la asignación final se completa cuando se
 * reservan los fondos en MOVO-12). Por lo tanto, nunca promete "envío confirmado".
 */
export function ChooseOfferSuccessModal({
  visible,
  carrierName,
  onDismiss,
  testID,
}: ChooseOfferSuccessModalProps) {
  const { isMounted, backdropStyle, sheetStyle } = useSheetAnimation(visible);

  const displayName = carrierName || "el transportista";

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
                <View className="h-14 w-14 items-center justify-center rounded-full bg-success-100">
                  <CheckCircle2 size={32} color="#16754A" strokeWidth={2.2} />
                </View>

                <View className="gap-2 items-center text-center">
                  <Text className="font-sans-semibold text-h3 text-fg text-center">
                    ¡Transportista elegido!
                  </Text>
                  <Text className="font-sans text-small leading-5 text-fg-2 text-center px-4">
                    Seleccionaste la propuesta de{" "}
                    <Text className="font-sans-semibold text-fg">{displayName}</Text>.
                    Tu envío quedó en espera de la confirmación del pago para iniciar el viaje.
                  </Text>
                </View>

                <View className="w-full pt-2">
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
