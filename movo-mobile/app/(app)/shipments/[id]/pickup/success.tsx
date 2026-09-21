import { useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { HandshakeConfirmationResult } from "../../../../../components/handshake/handshake-confirmation-result";
import { usePickupResult } from "./_layout";

/**
 * Paso terminal del wizard de retiro (MOVO-198 AC10): reusa `HandshakeConfirmationResult`
 * tal cual (rediseño MOVO-198 sobre el prototipo "Success de entrega" -- barrido
 * lime + hoja con ruta/ETA real hacia la entrega, CTA horneado dentro del propio
 * componente). Invalida el detalle del envío ANTES de navegar, así el transportista
 * lo ve ya en `in_transit` sin depender de un refetch en el aire.
 *
 * El CTA navega a `/route` (mapa de seguimiento en vivo) -- esa ruta todavía no
 * existe en el repo (la va a construir el usuario aparte), así que hoy cae en la
 * pantalla "no encontrada" de expo-router hasta que se construya. Documentado a
 * propósito, no un bug de este archivo.
 */
export default function PickupSuccessScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { result } = usePickupResult();

  function goToShipment() {
    void queryClient.invalidateQueries({ queryKey: ["shipments", "detail", id] });
    router.replace(`/shipments/${id}`);
  }

  function goToRoute() {
    void queryClient.invalidateQueries({ queryKey: ["shipments", "detail", id] });
    router.replace(`/route?shipmentId=${id}` as any);
  }

  if (!result) {
    // Reingreso directo a esta ruta sin haber pasado por `scan.tsx` en esta sesión
    // (el resultado no sobrevive a un cierre de la app) -- degrada a un mensaje
    // simple en vez de romper, el estado real del envío se ve en el detalle.
    return (
      <SafeAreaView className="flex-1 items-center justify-center gap-4 bg-ink-950 px-8">
        <Text testID="pickup-success-no-result" className="text-center font-sans text-body text-ink-300">
          No tenemos el detalle de esta confirmación a mano, pero podés ver el estado
          actual del envío.
        </Text>
        <Pressable
          testID="pickup-success-no-result-cta"
          onPress={goToShipment}
          className="w-full items-center justify-center rounded-lg bg-paper py-3.5 active:opacity-85"
        >
          <Text className="font-sans-semibold text-body text-ink-950">Ver envío</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-ink-950">
      <HandshakeConfirmationResult
        testID="pickup-success-result"
        result={result}
        onCtaPress={result.stage === "pickup" ? goToRoute : goToShipment}
      />
    </SafeAreaView>
  );
}
