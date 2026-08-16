import { router } from "expo-router";
import { PackagePlus } from "lucide-react-native";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PrimaryButton } from "../../components/auth/primary-button";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

/**
 * Punto de entrada al wizard de creación de envío (MOVO-83, AC1: se abre desde el tab
 * Inicio, no es un tab propio — ver `HomeSendCta`). Placeholder a propósito: el wizard
 * en sí (pasos de paquete/direcciones/receptor/confirmación) es un ticket aparte,
 * todavía sin arrancar aunque el backend que va a consumir (`POST /shipments`,
 * MOVO-80) ya está Done. Sirve para dejar la navegación real cableada de punta a punta
 * sin inventar un destino falso.
 *
 * Sibling de `license-kyc.tsx` dentro de `app/(app)/` (no de `(tabs)/`) — mismo
 * criterio: una pantalla de flujo completo con su propio header, no otro ítem de la
 * tab bar flotante.
 */
export default function SendShipmentScreen() {
  const colors = useThemeColors();

  return (
    <SafeAreaView className="flex-1 bg-bg px-6" edges={["top", "bottom"]}>
      <View className="flex-1 items-center justify-center gap-3">
        <PackagePlus size={32} strokeWidth={1.8} color={colors.fg3} />
        <Text className="text-center font-sans-semibold text-h3 text-fg">
          El wizard de creación de envío todavía no está disponible
        </Text>
        <Text className="text-center font-sans text-body text-fg-2">
          Estamos trabajando en esto. Volvé a intentarlo más adelante.
        </Text>
      </View>
      <PrimaryButton testID="send-screen-back" label="Volver a Inicio" onPress={() => router.back()} />
    </SafeAreaView>
  );
}
