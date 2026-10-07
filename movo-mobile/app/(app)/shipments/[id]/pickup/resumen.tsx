import { router, useLocalSearchParams } from "expo-router";
import type { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CounterpartCard } from "../../../../../components/shipments/counterpart-card";
import { PackageCard } from "../../../../../components/shipments/package-card";
import { WizardStepHeader } from "../../../../../components/shipments/wizard-step-header";
import { PrimaryButton } from "../../../../../components/auth/primary-button";
import { ErrorBanner } from "../../../../../components/ui/error-banner";
import { SkeletonBlock } from "../../../../../components/ui/skeleton-block";
import { useShipment } from "../../../../../src/hooks/use-shipments";
import { formatPickupDateLabel, formatPickupWindowLabel, shortAddressLabel } from "../../../../../src/lib/shipment-format";

function Eyebrow({ children }: { children: ReactNode }) {
  return <Text className="mb-1.5 font-sans-medium text-caption uppercase text-fg-3">{children}</Text>;
}

/**
 * Paso 2 del wizard de retiro (MOVO-198, rediseño): resumen del retiro solo
 * -- proximidad (paso 1) y aviso de QR (paso 3) se separaron en pantallas propias.
 *
 * El AC7 original ("con evidencia ya satisfecha, saltar directo a escaneo") se
 * sacó a pedido del usuario tras probarlo en dispositivo: un envío reusado a mano
 * durante QA (mismo shipment, varias corridas con el botón dev) ya tenía evidencia
 * confirmada de una corrida anterior, así que "Empezar el retiro" saltaba directo a
 * `scan` sin pasar por el aviso de QR ni por la pantalla de fotos -- confuso incluso
 * cuando es el comportamiento "correcto" según ese AC, porque el usuario nunca vio
 * el paso de evidencia en esta sesión. Ahora el botón siempre entra por `qr` (que
 * encadena a `evidence`); `evidence.tsx` sigue mostrando fotos ya confirmadas como
 * satisfechas de entrada (`EvidenceCaptureStep`/`useEvidenceStatus`, MOVO-197), así
 * que reingresar con evidencia completa no obliga a sacar fotos de nuevo, solo a
 * pasar visualmente por el paso.
 */
export default function PickupResumenScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: shipment, isLoading, isError } = useShipment(id);

  function handleContinue() {
    router.push(`/shipments/${id}/pickup/qr`);
  }

  if (isLoading || !shipment) {
    return (
      <SafeAreaView className="flex-1 bg-bg">
        <View className="gap-4 px-5 pt-4">
          <SkeletonBlock className="h-32 w-full rounded-[14px]" />
          <SkeletonBlock className="h-20 w-full rounded-[14px]" />
          <SkeletonBlock className="h-16 w-full rounded-[14px]" />
        </View>
      </SafeAreaView>
    );
  }

  if (isError) {
    return (
      <SafeAreaView className="flex-1 bg-bg px-5 pt-4">
        <ErrorBanner testID="pickup-resumen-error" message="No pudimos cargar este envío." />
      </SafeAreaView>
    );
  }

  const dateLabel = formatPickupDateLabel(shipment.pickupDate);
  const windowLabel = formatPickupWindowLabel(shipment.pickupTimeWindowStart, shipment.pickupTimeWindowEnd);

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <WizardStepHeader
        testIDPrefix="pickup-resumen"
        title="Resumen del retiro"
        step={2}
        totalSteps={5}
        onBack={() => router.back()}
      />

      <ScrollView contentContainerClassName="gap-5 px-5 pb-6" showsVerticalScrollIndicator={false}>
        <View className="gap-1.5 rounded-[14px] border border-border bg-bg px-4 py-3.5">
          <Eyebrow>Retiro</Eyebrow>
          <Text className="font-sans-semibold text-[15px] text-fg">
            {shortAddressLabel(shipment.pickupAddress)}
          </Text>
          <Text className="font-sans text-small text-fg-2">
            {[dateLabel, windowLabel].filter(Boolean).join(" · ")}
          </Text>
        </View>

        <View>
          <Eyebrow>Emisor</Eyebrow>
          <CounterpartCard
            testID="pickup-resumen-sender"
            userId={shipment.senderId}
            onPress={() => router.push(`/profile/${shipment.senderId}`)}
          />
        </View>

        <View>
          <Eyebrow>Paquete</Eyebrow>
          <PackageCard testID="pickup-resumen-package" shipment={shipment} />
        </View>
      </ScrollView>

      <PrimaryButton testID="pickup-resumen-continue" label="Empezar el retiro" onPress={handleContinue} />
    </SafeAreaView>
  );
}
