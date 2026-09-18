import { router, useLocalSearchParams } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { EvidenceCaptureStep } from "../../../../../components/evidence/evidence-capture-step";
import { PrimaryButton } from "../../../../../components/auth/primary-button";
import { useThemeColors } from "../../../../../src/hooks/use-theme-colors";

/**
 * Paso 2 del wizard de retiro (MOVO-198): monta el step reusable de MOVO-197 tal
 * cual, sin tocarlo -- ese componente no es dueño de la navegación (documentado en
 * su propio JSDoc), así que el botón "Continuar" vive acá.
 */
export default function PickupEvidenceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useThemeColors();
  const [isValid, setIsValid] = useState(false);

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <View className="flex-row items-center gap-3 px-5 pb-3.5 pt-1.5">
        <Pressable
          testID="pickup-evidence-back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace(`/shipments/${id}/pickup`))}
          className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute active:opacity-75"
          accessibilityRole="button"
          accessibilityLabel="Volver"
        >
          <ChevronLeft size={18} color={colors.fg1} strokeWidth={2} />
        </Pressable>
        <Text className="font-sans-semibold text-h3 text-fg">Evidencia del retiro</Text>
      </View>

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
