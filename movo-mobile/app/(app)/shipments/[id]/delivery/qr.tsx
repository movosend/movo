import { useQueryClient } from "@tanstack/react-query";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { HandshakeQrCard } from "../../../../../components/handshake/handshake-qr-card";
import { WizardStepHeader } from "../../../../../components/shipments/wizard-step-header";
import type { ConfirmHandshakeResult, ShipmentSummary } from "../../../../../src/api/shipments-client";
import { useEvidenceStatus, useShipment } from "../../../../../src/hooks/use-shipments";
import { useHandshakeQr } from "../../../../../src/hooks/use-handshake-qr";
import { usePublicProfile } from "../../../../../src/hooks/use-profile";
import { useDeliveryResult } from "./_layout";

/**
 * Paso 5 del wizard de entrega (MOVO-199): el transportista GENERA el QR acá (roles
 * invertidos respecto de `pickup/scan.tsx`, donde el transportista escanea el del
 * emisor -- confirmado contra `handshake.service.ts`: en delivery el cedente es el
 * transportista, el receptor de custodia es el receptor del envío). Monta
 * `useHandshakeQr`/`HandshakeQrCard` (ya existentes, usados hoy por la pantalla
 * standalone `/handshake`) dentro del header de pasos del wizard, con
 * `initialStage="delivery"` fijo -- no hace falta que el backend lo re-infiera acá,
 * ya se sabe por el gate del `_layout` (`status === IN_TRANSIT`).
 *
 * El QR se renueva solo antes de vencer (TTL de 15s del backend), sin countdown
 * visible -- el reintento manual queda solo para errores. El polling propio del hook detecta la confirmación del receptor
 * (`IN_TRANSIT → DELIVERED`/`COMPLETED`) y dispara `onConfirmed` -- AC6, navegación
 * automática a la confirmación sin acción del transportista.
 *
 * **`ConfirmHandshakeResult` sintético, no real**: a diferencia de `pickup/scan.tsx`
 * (que llama `confirmHandshake` él mismo y obtiene la respuesta real del servidor),
 * acá el transportista nunca confirma -- el receptor lo hace, fuera de este wizard
 * (MOVO-160). Lo único que este paso sabe es que el polling detectó el cambio de
 * estado del envío. `previousStatus`/`status` se completan con certeza (el gate del
 * `_layout` ya garantiza `IN_TRANSIT` de entrada); `distanceM` no tiene equivalente
 * real del lado del cedente y queda en `0` -- `HandshakeConfirmationResult` no lo
 * renderiza (solo lee `stage`/`shipmentId`/`confirmedAt`), así que no es un dato que
 * la UI le muestre al usuario.
 */
export default function DeliveryQrScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const evidenceStatus = useEvidenceStatus(id);
  const { data: shipment } = useShipment(id);
  const { data: receiverProfile } = usePublicProfile(shipment?.receiverId);
  const { setResult } = useDeliveryResult();

  // AC3: no asume que la evidencia sigue satisfecha -- si el estado todavía no
  // resolvió, se espera acá en vez de arriesgar un salto directo sin evidencia.
  if (evidenceStatus.isLoading) {
    return <View className="flex-1 bg-ink-950" />;
  }

  if (evidenceStatus.data?.satisfied !== true) {
    return <Redirect href={`/shipments/${id}/delivery/evidence`} />;
  }

  function handleConfirmed(freshShipment: ShipmentSummary) {
    const result: ConfirmHandshakeResult = {
      shipmentId: freshShipment.id,
      stage: "delivery",
      previousStatus: ShipmentStatus.IN_TRANSIT,
      status: freshShipment.status,
      distanceM: 0,
      confirmedAt: new Date().toISOString(),
    };
    setResult(result);
    router.replace(`/shipments/${id}/delivery/success`);
  }

  function handleEvidenceMissing() {
    // AC7: caso defensivo -- el backend igual rechazó por evidencia pese al gate de
    // arriba (ej. una foto se invalidó entre que se cargó este paso y se generó el QR).
    void queryClient.invalidateQueries({ queryKey: ["shipments", "detail", id, "evidence-status"] });
    router.replace(`/shipments/${id}/delivery/evidence`);
  }

  return (
    <DeliveryQrContent
      shipmentId={id}
      counterpartName={receiverProfile?.fullName?.split(" ")[0]}
      onConfirmed={handleConfirmed}
      onEvidenceMissing={handleEvidenceMissing}
    />
  );
}

function DeliveryQrContent({
  shipmentId,
  counterpartName,
  onConfirmed,
  onEvidenceMissing,
}: {
  shipmentId: string;
  counterpartName: string | undefined;
  onConfirmed: (shipment: ShipmentSummary) => void;
  onEvidenceMissing: () => void;
}) {
  const { qrPayload, status, error, regenerate } =
    useHandshakeQr({
      shipmentId,
      initialStage: "delivery",
      onConfirmed,
      onEvidenceMissing,
    });

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <WizardStepHeader testIDPrefix="delivery-qr" title="Generá el código" step={5} totalSteps={5} onBack={() => router.back()} />
      {/* Sin ScrollView: el contenido entra en pantalla y un View plano garantiza que
          el área del QR ocupe todo el alto restante para centrarlo de verdad. */}
      <View className="flex-1 px-5 pb-6">
        <HandshakeQrCard
          testID="delivery-qr-card"
          qrPayload={qrPayload}
          isGenerating={status === "generating"}
          error={error}
          counterpartName={counterpartName}
          stage="delivery"
          onRegenerate={regenerate}
        />
      </View>
    </SafeAreaView>
  );
}
