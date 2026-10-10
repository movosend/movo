import type { ReactNode } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";
import { SafeAreaProvider, SafeAreaView, initialWindowMetrics } from "react-native-safe-area-context";
import { useSheetAnimation } from "../../src/hooks/use-sheet-animation";

const FALLBACK_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

export interface BottomSheetModalProps {
  visible: boolean;
  /** Backdrop y botón físico de atrás. El caller decide si se puede cerrar (ej. mientras hay una mutación). */
  onRequestClose: () => void;
  testID: string;
  backdropTestID: string;
  /** Clases de la hoja (radio, borde, fondo, padding). */
  sheetClassName?: string;
  backdropClassName?: string;
  /** Clases del `SafeAreaView` que envuelve el contenido (ej. `gap-4`). */
  contentClassName?: string;
  children: ReactNode;
}

/**
 * Hoja inferior con overlay que hace fade y hoja que se desliza (`useSheetAnimation`),
 * dentro de un `Modal` nativo con su propio `SafeAreaProvider` (el modal queda fuera del
 * árbol del provider de la app). Es el boilerplate que repetían los sheets de confirmación.
 */
export function BottomSheetModal({
  visible,
  onRequestClose,
  testID,
  backdropTestID,
  sheetClassName = "rounded-t-2xl bg-bg px-5 pt-5",
  backdropClassName = "bg-black/40",
  contentClassName,
  children,
}: BottomSheetModalProps) {
  const { isMounted, backdropStyle, sheetStyle } = useSheetAnimation(visible);
  if (!isMounted) return null;

  return (
    <Modal visible={isMounted} animationType="none" transparent onRequestClose={onRequestClose} testID={testID}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics ?? FALLBACK_METRICS}>
        <View className="flex-1">
          <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
            <Pressable
              testID={backdropTestID}
              accessibilityRole="button"
              accessibilityLabel="Cerrar"
              onPress={onRequestClose}
              className={`flex-1 ${backdropClassName}`}
            />
          </Animated.View>

          <View pointerEvents="box-none" className="flex-1 justify-end">
            <Animated.View style={sheetStyle} className={sheetClassName}>
              <SafeAreaView edges={["bottom"]} className={contentClassName}>
                {children}
              </SafeAreaView>
            </Animated.View>
          </View>
        </View>
      </SafeAreaProvider>
    </Modal>
  );
}
