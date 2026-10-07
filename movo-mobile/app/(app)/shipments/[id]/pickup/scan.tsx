import { useQueryClient } from "@tanstack/react-query";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { HandshakeScanStep } from "../../../../../components/handshake/handshake-scan-step";
import { EvidenceStatusError } from "../../../../../components/evidence/evidence-status-error";
import { WizardStepHeader } from "../../../../../components/shipments/wizard-step-header";
import type { ConfirmHandshakeResult } from "../../../../../src/api/shipments-client";
import { useEvidenceStatus } from "../../../../../src/hooks/use-shipments";
import { usePickupResult } from "./_layout";

/**
 * Paso 5 del wizard de retiro (MOVO-198 AC3/AC8/AC9): monta `HandshakeScanStep`
 * (MOVO-160) tal cual, sin bifurcar por `stage` -- ese componente no lo necesita, el
 * backend lo infiere. Gana el header compartido del rediseño (antes esta pantalla no
 * tenía ninguno) sin tocar la lógica de gate/confirmación de abajo.
 */
export default function PickupScanScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const evidenceStatus = useEvidenceStatus(id);
  const { setResult } = usePickupResult();

  // AC3: no asume que la evidencia sigue satisfecha -- si el estado todavía no
  // resolvió, se espera acá en vez de arriesgar un salto directo sin evidencia.
  if (evidenceStatus.isLoading) {
    return <View className="flex-1 bg-ink-950" />;
  }

  // Solo si no hay ningún dato: con un valor previo en caché (ej. el que dejó el paso
  // de evidencia) un refetch fallido no cambia lo que ya se sabe.
  if (evidenceStatus.isError && !evidenceStatus.data) {
    return (
      <EvidenceStatusError
        onRetry={() => void evidenceStatus.refetch()}
        isRetrying={evidenceStatus.isFetching}
      />
    );
  }

  if (evidenceStatus.data?.satisfied !== true) {
    return <Redirect href={`/shipments/${id}/pickup/evidence`} />;
  }

  function handleConfirmed(result: ConfirmHandshakeResult) {
    setResult(result);
    router.replace(`/shipments/${id}/pickup/success`);
  }

  function handleEvidenceMissing() {
    // AC9: caso defensivo -- el backend igual rechazó por evidencia pese al gate de
    // arriba (ej. una foto se invalidó entre que se cargó este paso y se escaneó).
    void queryClient.invalidateQueries({ queryKey: ["shipments", "detail", id, "evidence-status"] });
    router.replace(`/shipments/${id}/pickup/evidence`);
  }

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top"]}>
      <WizardStepHeader
        testIDPrefix="pickup-scan"
        title="Escaneá el QR"
        step={5}
        totalSteps={5}
        onBack={() => router.back()}
      />
      <HandshakeScanStep
        testID="pickup-scan-step"
        shipmentId={id}
        onConfirmed={handleConfirmed}
        onEvidenceMissing={handleEvidenceMissing}
      />
    </SafeAreaView>
  );
}
