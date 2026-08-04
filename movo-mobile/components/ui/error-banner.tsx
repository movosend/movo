import { Text, View } from "react-native";

interface ErrorBannerProps {
  message: string | null;
  testID?: string;
}

/**
 * Banner de error persistente compartido — para fallas de red/API a nivel de
 * pantalla o paso (no para errores de validación de un campo puntual, esos
 * van con la prop `error` de `TextField`/`SelectField`). Se queda visible
 * hasta que la acción se reintenta con éxito o se navega fuera del paso;
 * nunca se auto-oculta con un timer, a propósito.
 */
export function ErrorBanner({ message, testID }: ErrorBannerProps) {
  if (!message) return null;
  return (
    <View
      testID={testID}
      className="mb-4 rounded-[10px] border border-danger-300 bg-danger-100 px-3.5 py-3"
    >
      <Text className="font-sans text-[13px] text-ink-950">{message}</Text>
    </View>
  );
}
