import { useCallback, useEffect, useRef, type RefObject } from "react";
import {
  Dimensions,
  Keyboard,
  Platform,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView,
  type TextInput,
} from "react-native";

const FOCUS_SCROLL_MARGIN = 24;

/**
 * `KeyboardAvoidingView` solo evita que el teclado tape el botón fijo abajo del
 * wizard (`behavior="padding"` encoge el `ScrollView`) — no hace scroll automático
 * al campo enfocado, RN no lo resuelve solo. Se engancha al evento nativo de
 * apertura del teclado (en vez de disparar el scroll al hacer foco) porque en el
 * primer tap el teclado todavía no terminó de abrir y no conocemos su alto real.
 */
export function useKeyboardScroll() {
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const focusedInputRef = useRef<RefObject<TextInput | null> | null>(null);

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollY.current = event.nativeEvent.contentOffset.y;
    },
    [],
  );

  const scrollToFocused = useCallback((keyboardHeight: number) => {
    const input = focusedInputRef.current?.current;
    if (!input) return;
    input.measureInWindow((_x, y, _width, height) => {
      const visibleBottom = Dimensions.get("window").height - keyboardHeight;
      const overlap = y + height - visibleBottom;
      if (overlap > 0) {
        scrollRef.current?.scrollTo({
          y: scrollY.current + overlap + FOCUS_SCROLL_MARGIN,
          animated: true,
        });
      }
    });
  }, []);

  useEffect(() => {
    const showEvent =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const subscription = Keyboard.addListener(showEvent, (event) => {
      scrollToFocused(event.endCoordinates.height);
    });
    return () => subscription.remove();
  }, [scrollToFocused]);

  const onFocusInput = useCallback((inputRef: RefObject<TextInput | null>) => {
    focusedInputRef.current = inputRef;
  }, []);

  return { scrollRef, onScroll, onFocusInput };
}

export type OnFocusInput = ReturnType<typeof useKeyboardScroll>["onFocusInput"];
