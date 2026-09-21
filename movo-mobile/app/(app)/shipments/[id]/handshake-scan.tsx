import { router, useLocalSearchParams } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { HandshakeConfirmationResult } from "../../../../components/handshake/handshake-confirmation-result";
import { HandshakeScanStep } from "../../../../components/handshake/handshake-scan-step";
import type { ConfirmHandshakeResult } from "../../../../src/api/shipments-client";
import { useShipment } from "../../../../src/hooks/use-shipments";
import { useThemeColors } from "../../../../src/hooks/use-theme-colors";

/**
 * Ruta standalone de MOVO-160 — todavía sin ningún CTA real que la abra (el de Home
 * depende de MOVO-192, sin backend; el de retiro ni existe hasta la fase 2 del home,
 * MOVO-206). Se prueba por ahora con navegación directa. `MOVO-198`/`MOVO-199`
 * (wizards de retiro/entrega) van a montar `HandshakeScanStep` como un paso más de
 * su propio flujo en vez de esta pantalla, cuando existan.
 */
export default function HandshakeScanScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useThemeColors();
  const { data: shipment } = useShipment(id);
  const [confirmedResult, setConfirmedResult] = useState<ConfirmHandshakeResult | null>(null);

  const title = shipment?.status === "in_transit" ? "Confirmar entrega" : "Confirmar retiro";

  return (
    <SafeAreaView className="flex-1 bg-ink-950" edges={confirmedResult ? ["top", "bottom"] : ["top"]}>
      <View className="flex-row items-center gap-3 px-5 pb-3.5 pt-1.5">
        <Pressable
          testID="handshake-scan-back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
          className="h-8 w-8 items-center justify-center rounded-full bg-white/10 active:opacity-75"
          accessibilityRole="button"
          accessibilityLabel="Volver"
        >
          <ChevronLeft size={18} color={confirmedResult ? colors.fg1 : "#FFFFFF"} strokeWidth={2} />
        </Pressable>
        <Text className={`font-sans-semibold text-h3 ${confirmedResult ? "text-fg" : "text-white"}`}>
          {confirmedResult ? "Confirmado" : title}
        </Text>
      </View>

      {confirmedResult ? (
        <View className="flex-1 bg-bg">
          <HandshakeConfirmationResult testID="handshake-confirmation-result" result={confirmedResult} />
          <View className="border-t border-border px-5 pb-6 pt-3.5">
            <Pressable
              testID="handshake-scan-back-home"
              onPress={() => router.replace("/")}
              className="w-full items-center justify-center rounded-lg bg-fg py-3.5"
            >
              <Text className="font-sans-semibold text-body text-bg">Volver a Inicio</Text>
            </Pressable>
          </View>
        </View>
      ) : !id ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#FFFFFF" />
        </View>
      ) : (
        <HandshakeScanStep
          testID="handshake-scan-step"
          shipmentId={id}
          onConfirmed={setConfirmedResult}
        />
      )}
    </SafeAreaView>
  );
}
