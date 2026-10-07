import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { EvidenceCaptureStep } from "../../../../../components/evidence/evidence-capture-step";
import { PrimaryButton } from "../../../../../components/auth/primary-button";
import { WizardStepHeader } from "../../../../../components/shipments/wizard-step-header";

/**
 * Paso 4 del wizard de retiro (MOVO-198): monta el step reusable de MOVO-197 tal
 * cual, sin tocarlo -- ese componente no es dueño de la navegación (documentado en
 * su propio JSDoc), así que el header/botón "Continuar" viven acá.
 */
export default function PickupEvidenceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [isValid, setIsValid] = useState(false);

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <WizardStepHeader
        testIDPrefix="pickup-evidence"
        title="Fotos de evidencia"
        step={4}
        totalSteps={5}
        onBack={() => (router.canGoBack() ? router.back() : router.replace(`/shipments/${id}/pickup/qr`))}
      />

      <ScrollView contentContainerClassName="px-5 pb-6" showsVerticalScrollIndicator={false}>
        <EvidenceCaptureStep shipmentId={id} stage="pickup" onValidityChange={setIsValid} />
      </ScrollView>

      <PrimaryButton
        testID="pickup-evidence-continue"
        label="Continuar"
        disabled={!isValid}
        onPress={() => router.push(`/shipments/${id}/pickup/scan`)}
      />
    </SafeAreaView>
  );
}
