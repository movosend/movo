import { AlertCircle } from "lucide-react-native";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PrimaryButton } from "../auth/primary-button";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

/**
 * Error de red al consultar `evidence-status` desde el paso del QR/escaneo de un
 * wizard (retiro MOVO-198, entrega MOVO-199). Sin esto, un fallo de la query dejaba
 * `data` en `undefined` y el paso redirigía a evidencia como si faltaran fotos: el
 * usuario quedaba en un bucle evidencia → QR → evidencia sin ver nunca el error real.
 */
export function EvidenceStatusError({
  onRetry,
  isRetrying,
  testID = "evidence-status-error",
}: {
  onRetry: () => void;
  isRetrying?: boolean;
  testID?: string;
}) {
  const colors = useThemeColors();
  return (
    <SafeAreaView testID={testID} className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <View className="flex-1 items-center justify-center gap-4 px-8">
        <View className="h-14 w-14 items-center justify-center rounded-full bg-bg-mute">
          <AlertCircle size={26} color={colors.fg2} strokeWidth={1.8} />
        </View>
        <Text className="text-center font-sans-semibold text-h3 text-fg">
          No pudimos verificar las fotos
        </Text>
        <Text className="text-center font-sans text-body text-fg-2">
          Revisá tu conexión y volvé a intentarlo. Las fotos que ya subiste no se pierden.
        </Text>
      </View>
      <PrimaryButton testID={`${testID}-retry`} label="Reintentar" onPress={onRetry} loading={isRetrying} />
    </SafeAreaView>
  );
}
