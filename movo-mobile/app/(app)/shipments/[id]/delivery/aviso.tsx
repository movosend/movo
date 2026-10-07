import { router, useLocalSearchParams } from "expo-router";
import { HelpCircle, Smartphone } from "lucide-react-native";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PrimaryButton } from "../../../../../components/auth/primary-button";
import { WizardStepHeader } from "../../../../../components/shipments/wizard-step-header";
import { usePublicProfile } from "../../../../../src/hooks/use-profile";
import { useShipment } from "../../../../../src/hooks/use-shipments";

/**
 * Paso 3 del wizard de entrega (MOVO-199): espejo de `pickup/qr.tsx` con los roles
 * invertidos -- acá no hay nada que pedirle al receptor, pero sí avisarle que abra
 * la app para escanear el código que el transportista va a generar al final. Va
 * ANTES de la evidencia (mismo orden que pickup) para que el receptor tenga el
 * tiempo de las fotos para tener la app lista. Personaliza el copy con el nombre
 * real del receptor cuando ya cargó, sin bloquear la pantalla si no.
 */
export default function DeliveryScanNoticeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: shipment } = useShipment(id);
  const { data: receiverProfile } = usePublicProfile(shipment?.receiverId);
  const receiverFirstName = receiverProfile?.fullName.split(" ")[0];

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <WizardStepHeader
        testIDPrefix="delivery-aviso"
        title="Antes de empezar"
        step={3}
        totalSteps={5}
        onBack={() => router.back()}
      />

      <View className="flex-1 items-center justify-center gap-6 px-8">
        <View className="h-24 w-24 items-center justify-center rounded-full bg-lime-200">
          <Smartphone size={40} color="#0A0A0B" strokeWidth={1.6} />
        </View>

        <View className="gap-2.5">
          <Text testID="delivery-aviso-title" className="text-center font-sans-semibold text-title text-fg">
            {receiverFirstName
              ? `Avisale a ${receiverFirstName} que abra Movo`
              : "Avisale al receptor que abra Movo"}
          </Text>
          <Text testID="delivery-aviso-copy" className="max-w-[32ch] text-center font-sans text-body text-fg-2">
            Va a tener que escanear con su app el código que generes vos. Sin ese
            escaneo no vas a poder cerrar la entrega.
          </Text>
        </View>

        <View className="flex-row items-start gap-3 rounded-[10px] border border-border bg-bg-mute px-4 py-3">
          <HelpCircle size={18} color="#5A5A62" strokeWidth={1.9} />
          <Text testID="delivery-aviso-sequence-hint" className="flex-1 font-sans text-small text-fg-2">
            Primero vas a sacar las fotos de evidencia. El código es el último paso.
          </Text>
        </View>
      </View>

      <PrimaryButton
        testID="delivery-aviso-continue"
        label="Entendido"
        onPress={() => router.push(`/shipments/${id}/delivery/evidence`)}
      />
    </SafeAreaView>
  );
}
