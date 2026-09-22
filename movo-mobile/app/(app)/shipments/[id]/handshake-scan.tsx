import { router, useLocalSearchParams } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { HandshakeConfirmationResult } from "../../../../components/handshake/handshake-confirmation-result";
import { HandshakeScanStep } from "../../../../components/handshake/handshake-scan-step";
import type { ConfirmHandshakeResult } from "../../../../src/api/shipments-client";
import { useShipment } from "../../../../src/hooks/use-shipments";

/**
 * Ruta standalone de MOVO-160 — todavía sin ningún CTA real que la abra (el de Home
 * depende de MOVO-192, sin backend; el de retiro ni existe hasta la fase 2 del home,
 * MOVO-206). Se prueba por ahora con navegación directa. `MOVO-198`/`MOVO-199`
 * (wizards de retiro/entrega) van a montar `HandshakeScanStep` como un paso más de
 * su propio flujo en vez de esta pantalla, cuando existan.
 *
 * El estado confirmado deja de tener su propio header/footer una vez que
 * `HandshakeConfirmationResult` (MOVO-198, rediseño) pasó a ser una pantalla
 * completa con su propio CTA horneado adentro — este archivo solo decide a dónde
 * va ese CTA.
 */
export default function HandshakeScanScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: shipment } = useShipment(id);
  const [confirmedResult, setConfirmedResult] = useState<ConfirmHandshakeResult | null>(null);

  const title = shipment?.status === "in_transit" ? "Confirmar entrega" : "Confirmar retiro";

  if (confirmedResult) {
    return (
      <SafeAreaView className="flex-1 bg-ink-950">
        <HandshakeConfirmationResult
          testID="handshake-confirmation-result"
          result={confirmedResult}
          ctaLabel="Volver a Inicio"
          onCtaPress={() => router.replace("/")}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-ink-950" edges={["top"]}>
      <View className="flex-row items-center gap-3 px-5 pb-3.5 pt-1.5">
        <Pressable
          testID="handshake-scan-back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
          className="h-8 w-8 items-center justify-center rounded-full bg-white/10 active:opacity-75"
          accessibilityRole="button"
          accessibilityLabel="Volver"
        >
          <ChevronLeft size={18} color="#FFFFFF" strokeWidth={2} />
        </Pressable>
        <Text className="font-sans-semibold text-h3 text-white">{title}</Text>
      </View>

      {!id ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#FFFFFF" />
        </View>
      ) : (
        <HandshakeScanStep testID="handshake-scan-step" shipmentId={id} onConfirmed={setConfirmedResult} />
      )}
    </SafeAreaView>
  );
}
