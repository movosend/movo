import { router, useLocalSearchParams } from "expo-router";
import { ChevronLeft, CreditCard } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useThemeColors } from "../../../../src/hooks/use-theme-colors";

/**
 * Placeholder de la pantalla de pago del envío. MOVO-211 deja cableados acá todos los CTAs
 * de la reserva ("Confirmar pago", "Retomar pago", "Reintentar con otra tarjeta" y
 * "Reservar el pago" al aceptar una oferta) para que la pantalla real con el formulario de
 * Mercado Pago (MOVO-269) solo tenga que reemplazar este archivo, sin tocar los callers.
 */
export default function ShipmentPaymentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useThemeColors();

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(`/(app)/shipments/${id}`);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <View className="flex-row items-center gap-3 px-5 pb-3.5 pt-1.5">
        <Pressable
          testID="shipment-payment-back"
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel="Volver"
          className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
        >
          <ChevronLeft size={18} color={colors.fg1} strokeWidth={2} />
        </Pressable>
        <Text className="font-sans-semibold text-h3 text-fg">Confirmar pago</Text>
      </View>

      <View testID="shipment-payment-placeholder" className="flex-1 items-center justify-center gap-3 px-8">
        <View className="h-14 w-14 items-center justify-center rounded-full bg-bg-mute">
          <CreditCard size={24} color={colors.fg2} strokeWidth={1.8} />
        </View>
        <Text className="text-center font-sans-semibold text-h3 text-fg">La confirmación del pago llega pronto</Text>
        <Text className="text-center font-sans text-small text-fg-2">
          Todavía no se puede ingresar la tarjeta desde la app. No se retuvo ni se cobró nada.
        </Text>
      </View>
    </SafeAreaView>
  );
}
