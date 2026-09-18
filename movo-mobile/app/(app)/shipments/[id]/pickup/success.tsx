import { useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { HandshakeConfirmationResult } from "../../../../../components/handshake/handshake-confirmation-result";
import { PrimaryButton } from "../../../../../components/auth/primary-button";
import { usePickupResult } from "./_layout";

/**
 * Paso 4 del wizard de retiro (MOVO-198 AC10): reusa `HandshakeConfirmationResult`
 * (MOVO-160) tal cual. Invalida el detalle del envío ANTES de volver, así el
 * transportista lo ve ya en `in_transit` sin depender de un refetch en el aire.
 */
export default function PickupSuccessScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { result } = usePickupResult();

  function goToShipment() {
    void queryClient.invalidateQueries({ queryKey: ["shipments", "detail", id] });
    router.replace(`/shipments/${id}`);
  }

  if (!result) {
    // Reingreso directo a esta ruta sin haber pasado por `scan.tsx` en esta sesión
    // (el resultado no sobrevive a un cierre de la app) -- degrada a un mensaje
    // simple en vez de romper, el estado real del envío se ve en el detalle.
    return (
      <SafeAreaView className="flex-1 items-center justify-center gap-4 bg-bg px-8">
        <Text testID="pickup-success-no-result" className="text-center font-sans text-body text-fg-2">
          No tenemos el detalle de esta confirmación a mano, pero podés ver el estado
          actual del envío.
        </Text>
        <PrimaryButton testID="pickup-success-no-result-cta" label="Ver envío" onPress={goToShipment} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <View className="flex-1">
        <HandshakeConfirmationResult testID="pickup-success-result" result={result} />
      </View>
      <PrimaryButton testID="pickup-success-cta" label="Volver al envío" onPress={goToShipment} />
    </SafeAreaView>
  );
}
