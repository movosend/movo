import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";

/**
 * Alto del teclado abierto (0 si está cerrado). Mismos eventos que `useKeyboardVisible`: en iOS
 * los `Will*` para acomodar la UI a la par de la animación; Android solo tiene los `Did*`.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvent, (event) => setHeight(event.endCoordinates.height));
    const hide = Keyboard.addListener(hideEvent, () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}
