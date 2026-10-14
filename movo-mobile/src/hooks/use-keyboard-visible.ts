import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";

/**
 * Si el teclado está abierto. En iOS escucha los eventos `Will*` para que la UI se acomode a
 * la par de la animación del teclado y no después; Android solo tiene los `Did*`.
 */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvent, () => setVisible(true));
    const hide = Keyboard.addListener(hideEvent, () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}
