import { TriangleAlert } from "lucide-react-native";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { SafeAreaProvider, SafeAreaView, initialWindowMetrics } from "react-native-safe-area-context";
import { useSheetAnimation } from "../../src/hooks/use-sheet-animation";
import type { LegalEntrySheetCopy } from "../../src/lib/legal-acceptance";

// Tono propio del prototipo ("Rediseño página Legal con estados de firma"), no la
// escala `warning` de tokens: acá es deliberadamente un círculo lime tenue (el
// acento de marca, "algo tuyo que hay que atender"), no una alerta de error — mismo
// criterio que otros chromes de un solo uso documentados como constantes locales
// (ej. `CHROME` de `transport/[id]/offer.tsx`).
const ICON_CIRCLE_BG = "#F6FEDF";
const ICON_COLOR = "#6E8E1E";

const FALLBACK_METRICS = {
  frame: { x: 0, y: 0, width: 0, height: 0 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

interface LegalEntrySheetProps {
  visible: boolean;
  copy: LegalEntrySheetCopy;
  onReview: () => void;
  /**
   * Callback opcional de descarte mantenido por retrocompatibilidad (MOVO-229).
   * En MOVO-244 la aceptación de términos pasó a ser obligatoria y bloqueante:
   * se eliminó el botón "Ahora no" y el sheet no se puede cerrar por backdrop ni
   * por gesto. El componente ya no invoca esta función internamente; se mantiene
   * como prop opcional para no romper consumidores existentes que aún la suministren.
   */
  onDismiss?: () => void;
  testID?: string;
}

/**
 * Sheet mostrado al abrir la app con Términos y/o Privacidad pendientes (MOVO-229/MOVO-244).
 * Es **bloqueante**: no permite cerrar con "Ahora no" ni tocando el fondo — el usuario debe
 * revisar y aceptar los términos para continuar.
 */
export function LegalEntrySheet({ visible, copy, onReview, testID = "legal-entry-sheet" }: LegalEntrySheetProps) {
  const { isMounted, backdropStyle, sheetStyle } = useSheetAnimation(visible);

  return (
    <Modal visible={isMounted} animationType="none" transparent onRequestClose={() => {}} testID={testID}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics ?? FALLBACK_METRICS}>
        <View className="flex-1">
          <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
            <View testID={`${testID}-backdrop`} className="flex-1 bg-black/40" />
          </Animated.View>
          <View className="flex-1 justify-end" pointerEvents="box-none">
            <Animated.View style={sheetStyle}>
              <SafeAreaView className="rounded-t-2xl bg-bg" edges={["bottom"]}>
                <View className="px-5 pb-6 pt-3.5">
                  <View className="mb-4 items-center">
                    <View className="h-1 w-9 rounded-full bg-border" />
                  </View>
                  <View
                    className="mb-4 h-11 w-11 items-center justify-center rounded-full"
                    style={{ backgroundColor: ICON_CIRCLE_BG }}
                  >
                    <TriangleAlert size={20} color={ICON_COLOR} strokeWidth={1.9} />
                  </View>
                  <Text className="mb-2 font-sans-semibold text-h2 text-fg">{copy.title}</Text>
                  <Text className="mb-5 font-sans text-[14.5px] leading-5 text-fg-2">{copy.body}</Text>

                  <Pressable
                    testID={`${testID}-review`}
                    onPress={onReview}
                    className="w-full items-center justify-center rounded-lg bg-fg py-3.5"
                  >
                    <Text className="font-sans-semibold text-body text-bg">Revisar y aceptar</Text>
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
