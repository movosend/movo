import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { EvidenceCaptureStep } from "../../../../../components/evidence/evidence-capture-step";
import { PrimaryButton } from "../../../../../components/auth/primary-button";
import { WizardStepHeader } from "../../../../../components/shipments/wizard-step-header";

/**
 * Paso 3 del wizard de entrega (MOVO-199, calcado de `pickup/evidence.tsx`
 * MOVO-198): monta el step reusable de MOVO-197 tal cual, sin tocarlo, con
 * `stage="delivery"` -- ese componente no es dueño de la navegación (documentado en
 * su propio JSDoc), así que el header/botón "Continuar" viven acá.
 */
export default function DeliveryEvidenceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [isValid, setIsValid] = useState(false);

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <WizardStepHeader
        testIDPrefix="delivery-evidence"
        title="Fotos de evidencia"
        step={3}
        totalSteps={5}
        onBack={() => (router.canGoBack() ? router.back() : router.replace(`/shipments/${id}/delivery/resumen`))}
      />

      <ScrollView contentContainerClassName="px-5 pb-6" showsVerticalScrollIndicator={false}>
        <EvidenceCaptureStep shipmentId={id} stage="delivery" onValidityChange={setIsValid} />
      </ScrollView>

      <PrimaryButton
        testID="delivery-evidence-continue"
        label="Continuar"
        disabled={!isValid}
        onPress={() => router.push(`/shipments/${id}/delivery/qr`)}
      />
    </SafeAreaView>
  );
}
