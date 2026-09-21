import { router, useLocalSearchParams } from "expo-router";
import { HelpCircle, QrCode } from "lucide-react-native";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PrimaryButton } from "../../../../../components/auth/primary-button";
import { PickupWizardStepHeader } from "../../../../../components/shipments/pickup-wizard-step-header";
import { usePublicProfile } from "../../../../../src/hooks/use-profile";
import { useShipment } from "../../../../../src/hooks/use-shipments";

/**
 * Paso 3 del wizard de retiro (MOVO-198, rediseño): el banner amarillo que antes
 * vivía embebido en el resumen pasa a ser su propia pantalla -- "un propósito por
 * pantalla" (decisión tomada con el usuario, en vez de un banner dentro del
 * escaneo). Personaliza el copy con el nombre real del emisor cuando ya cargó
 * (mismo patrón que `use-attention-tasks.ts`), sin bloquear la pantalla si no.
 */
export default function PickupQrNoticeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: shipment } = useShipment(id);
  const { data: senderProfile } = usePublicProfile(shipment?.senderId);
  const senderFirstName = senderProfile?.fullName.split(" ")[0];

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <PickupWizardStepHeader
        testIDPrefix="pickup-qr"
        title="Antes de empezar"
        step={3}
        totalSteps={5}
        onBack={() => router.back()}
      />

      <View className="flex-1 items-center justify-center gap-6 px-8">
        <View className="h-24 w-24 items-center justify-center rounded-full bg-lime-200">
          <QrCode size={40} color="#0A0A0B" strokeWidth={1.6} />
        </View>

        <View className="gap-2.5">
          <Text className="text-center font-sans-semibold text-title text-fg">
            {senderFirstName ? `Pedile el QR a ${senderFirstName}` : "Pedile el QR al emisor"}
          </Text>
          <Text testID="pickup-qr-copy" className="max-w-[32ch] text-center font-sans text-body text-fg-2">
            Lo encuentra en el detalle del envío, dentro de su app. Sin ese código no
            vas a poder cerrar el retiro.
          </Text>
        </View>

        <View className="flex-row items-start gap-3 rounded-[10px] border border-border bg-bg-mute px-4 py-3">
          <HelpCircle size={18} color="#5A5A62" strokeWidth={1.9} />
          <Text testID="pickup-qr-sequence-hint" className="flex-1 font-sans text-small text-fg-2">
            Primero vas a sacar las fotos de evidencia. El QR es el último paso.
          </Text>
        </View>
      </View>

      <PrimaryButton
        testID="pickup-qr-continue"
        label="Entendido"
        onPress={() => router.push(`/shipments/${id}/pickup/evidence`)}
      />
    </SafeAreaView>
  );
}
