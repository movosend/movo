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
import { shortAddressLabel } from "../../../../../src/lib/shipment-format";

function Eyebrow({ children }: { children: ReactNode }) {
  return <Text className="mb-1.5 font-sans-medium text-caption uppercase text-fg-3">{children}</Text>;
}

/**
 * Paso 2 del wizard de entrega (MOVO-199, calcado de `pickup/resumen.tsx`
 * MOVO-198): resumen de la entrega -- dirección, contacto del receptor, datos del
 * paquete. El aviso del AC4 ("el receptor tiene que abrir su app y escanear") vive
 * en su propio paso (`aviso.tsx`), igual que el aviso de QR en pickup.
 */
export default function DeliveryResumenScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: shipment, isLoading, isError } = useShipment(id);

  function handleContinue() {
    router.push(`/shipments/${id}/delivery/aviso`);
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
        <ErrorBanner testID="delivery-resumen-error" message="No pudimos cargar este envío." />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <WizardStepHeader
        testIDPrefix="delivery-resumen"
        title="Resumen de la entrega"
        step={2}
        totalSteps={5}
        onBack={() => router.back()}
      />

      <ScrollView contentContainerClassName="gap-5 px-5 pb-6" showsVerticalScrollIndicator={false}>
        <View className="gap-1.5 rounded-[14px] border border-border bg-bg px-4 py-3.5">
          <Eyebrow>Entrega</Eyebrow>
          <Text className="font-sans-semibold text-[15px] text-fg">
            {shortAddressLabel(shipment.deliveryAddress)}
          </Text>
        </View>

        <View>
          <Eyebrow>Receptor</Eyebrow>
          <CounterpartCard
            testID="delivery-resumen-receiver"
            userId={shipment.receiverId}
            onPress={() => router.push(`/profile/${shipment.receiverId}`)}
          />
        </View>

        <View>
          <Eyebrow>Paquete</Eyebrow>
          <PackageCard testID="delivery-resumen-package" shipment={shipment} />
        </View>
      </ScrollView>

      <PrimaryButton testID="delivery-resumen-continue" label="Empezar la entrega" onPress={handleContinue} />
    </SafeAreaView>
  );
}
