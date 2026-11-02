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
 * Escaneo del QR de quien recibe la custodia (MOVO-160), sin wizard: el receptor llega desde el CTA
 * de su home para confirmar la entrega (`shipmentDetailCta`). El transportista escanea el retiro
 * dentro de su propio wizard (MOVO-198), que monta `HandshakeScanStep` como un paso más.
 *
 * El estado confirmado es `HandshakeConfirmationResult` a pantalla completa, con su CTA horneado
 * adentro: este archivo solo decide a dónde va ese CTA y desde qué lado se lee el texto (en la
 * entrega quien escanea es el receptor, MOVO-346).
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
          viewer={confirmedResult.stage === "delivery" ? "receiver" : "carrier"}
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
