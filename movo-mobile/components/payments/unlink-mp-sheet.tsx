import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { SafeAreaProvider, SafeAreaView, initialWindowMetrics } from "react-native-safe-area-context";
import { useSheetAnimation } from "../../src/hooks/use-sheet-animation";

const FALLBACK_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

export interface UnlinkMpSheetProps {
  visible: boolean;
  isPending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Confirmación de "Desvincular" (MOVO-112 AC5), fiel al mockup: un sheet propio y no un
 * `Alert`, mismo patrón `Modal` + `useSheetAnimation` que `reject-offer-modal.tsx`.
 * Mientras se desvincula no se puede cerrar.
 */
export function UnlinkMpSheet({ visible, isPending, onConfirm, onClose }: UnlinkMpSheetProps) {
  const { isMounted, backdropStyle, sheetStyle } = useSheetAnimation(visible);
  if (!isMounted) return null;

  const close = () => {
    if (!isPending) onClose();
  };

  return (
    <Modal visible={isMounted} animationType="none" transparent onRequestClose={close} testID="unlink-mp-sheet">
      <SafeAreaProvider initialMetrics={initialWindowMetrics ?? FALLBACK_METRICS}>
        <View className="flex-1">
          <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
            <Pressable testID="unlink-mp-sheet-backdrop" onPress={close} className="flex-1 bg-black/40" />
          </Animated.View>

          <View pointerEvents="box-none" className="flex-1 justify-end">
            <Animated.View style={sheetStyle} className="rounded-t-2xl bg-bg px-5 pt-5">
              <SafeAreaView edges={["bottom"]}>
                <Text className="mb-1 font-sans-semibold text-[17px] leading-[22px] text-fg">
                  ¿Desvincular Mercado Pago?
                </Text>
                <Text className="mb-4 font-sans text-[13px] leading-[18px] text-fg-3">
                  Si desvinculás tu cuenta, no vas a poder cobrar tus envíos hasta volver a vincularla. ¿Continuar?
                </Text>
                <View className="gap-2.5 pb-2 pt-2">
                  <Pressable
                    testID="unlink-mp-sheet-confirm"
                    onPress={onConfirm}
                    disabled={isPending}
                    className="h-12 items-center justify-center rounded-lg bg-danger-500 active:opacity-80"
                  >
                    {isPending ? (
                      <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : (
                      <Text className="font-sans-semibold text-[15px] text-white">Desvincular</Text>
                    )}
                  </Pressable>
                  <Pressable
                    testID="unlink-mp-sheet-cancel"
                    onPress={close}
                    disabled={isPending}
                    className="items-center py-2.5"
                  >
                    <Text className="font-sans-medium text-[15px] text-fg-2">Volver</Text>
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
