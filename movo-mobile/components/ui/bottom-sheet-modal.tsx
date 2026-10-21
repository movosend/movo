import { useEffect, useRef, type ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";
import { SafeAreaProvider, SafeAreaView, initialWindowMetrics } from "react-native-safe-area-context";
import { useKeyboardVisible } from "../../src/hooks/use-keyboard-visible";
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
  /** Se llama cuando la hoja terminó de cerrarse y su `Modal` nativo ya no está. iOS no presenta
   * un `Modal` mientras otro se está cerrando: quien abre otro después de este tiene que esperar
   * este aviso en vez de abrirlo en el mismo render en que lo cierra. */
  onClosed?: () => void;
  /** La hoja sube con el teclado (sheets con un campo de texto, ej. renombrar una tarjeta). */
  avoidKeyboard?: boolean;
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
  onClosed,
  avoidKeyboard = false,
  children,
}: BottomSheetModalProps) {
  const { isMounted, backdropStyle, sheetStyle } = useSheetAnimation(visible);
  // Con el teclado abierto la hoja se apoya sobre él: el margen del indicador de inicio sobra.
  const keyboardVisible = useKeyboardVisible();
  const bottomEdge = !(avoidKeyboard && keyboardVisible);

  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;
  const wasMountedRef = useRef(isMounted);
  useEffect(() => {
    if (wasMountedRef.current && !isMounted) onClosedRef.current?.();
    wasMountedRef.current = isMounted;
  }, [isMounted]);

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

          <KeyboardAvoidingView
            pointerEvents="box-none"
            enabled={avoidKeyboard}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            className="flex-1 justify-end"
          >
            <Animated.View style={sheetStyle} className={sheetClassName}>
              <SafeAreaView edges={bottomEdge ? ["bottom"] : []} className={contentClassName}>
                {children}
              </SafeAreaView>
            </Animated.View>
          </KeyboardAvoidingView>
        </View>
      </SafeAreaProvider>
    </Modal>
  );
}
