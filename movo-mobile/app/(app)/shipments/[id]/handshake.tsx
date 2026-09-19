import React, { useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useAuthStore } from "../../../../src/store/auth-store";
import { useShipment } from "../../../../src/hooks/use-shipments";
import { usePublicProfile } from "../../../../src/hooks/use-profile";
import { useHandshakeQr } from "../../../../src/hooks/use-handshake-qr";
import { HandshakeQrCard } from "../../../../components/handshake/handshake-qr-card";
import { HandshakeSuccessView } from "../../../../components/handshake/handshake-success-view";
import { HandshakeDeviceKeyWarning } from "../../../../components/handshake/handshake-device-key-warning";
import { ErrorBanner } from "../../../../components/ui/error-banner";
import { friendlyErrorMessage } from "../../../../src/lib/error-messages";
import { ShipmentStatus } from "@movo/shared";

export default function ShipmentHandshakeScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const shipmentId = id ?? "";

  const currentUserId = useAuthStore((state) => state.user?.userId);

  // 1. Cargar el envío
  const {
    data: shipment,
    isLoading: isLoadingShipment,
    error: shipmentError,
    refetch: refetchShipment,
  } = useShipment(shipmentId);

  // 2. Determinar etapa (retiro o entrega) y contraparte
  // Si el usuario es el emisor: está entregando el paquete al transportista (pickup)
  // Si el usuario es el transportista: está entregando el paquete al receptor (delivery)
  const isSender = shipment !== undefined && currentUserId === shipment.senderId;
  const isCarrier = shipment !== undefined && currentUserId === shipment.carrierId;

  const stage: "pickup" | "delivery" | null = useMemo(() => {
    if (!shipment) return null;
    if (isSender) return "pickup";
    if (isCarrier) return "delivery";
    // Fallback según estado del envío
    return shipment.status === ShipmentStatus.ASSIGNED ? "pickup" : "delivery";
  }, [shipment, isSender, isCarrier]);

  const counterpartId = useMemo(() => {
    if (!shipment) return undefined;
    return (stage === "pickup" ? shipment.carrierId : shipment.receiverId) ?? undefined;
  }, [shipment, stage]);

  const { data: counterpartProfile } = usePublicProfile(counterpartId);
  const counterpartFirstName = counterpartProfile?.fullName?.split(" ")[0];

  // 3. Hook de Handshake QR
  const {
    status: qrStatus,
    qrPayload,
    secondsLeft,
    totalSeconds,
    progressPercent,
    isExpiringSoon,
    isExpired,
    error: qrError,
    confirmedShipment,
    deviceKeyStatus,
    retryDeviceKey,
    regenerate,
  } = useHandshakeQr({
    shipmentId,
    initialStage: stage ?? undefined,
    onConfirmed: () => {
      void refetchShipment();
    },
  });

  const handleBack = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(`/(app)/shipments/${shipmentId}`);
    }
  };

  const isConfirmed =
    qrStatus === "confirmed" ||
    (shipment &&
      ((stage === "pickup" && shipment.status === ShipmentStatus.IN_TRANSIT) ||
        (stage === "delivery" &&
          (shipment.status === ShipmentStatus.DELIVERED ||
            shipment.status === ShipmentStatus.COMPLETED))));

  // Pantalla de Éxito cuando se confirma la custodia
  if (isConfirmed && (confirmedShipment || shipment)) {
    return (
      <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
        <HandshakeSuccessView
          shipment={confirmedShipment ?? shipment!}
          stage={stage}
          onBackToShipment={() => {
            router.replace(`/(app)/shipments/${shipmentId}`);
          }}
          onGoHome={() => {
            router.replace("/(app)/(tabs)/home");
          }}
        />
      </SafeAreaView>
    );
  }

  const screenTitle = stage === "pickup" ? "Confirmar retiro" : "Confirmar entrega";

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      {/* Header */}
      <View className="flex-row items-center justify-between border-b border-border px-4 py-3">
        <Pressable
          testID="handshake-back-button"
          onPress={handleBack}
          hitSlop={8}
          className="h-10 w-10 items-center justify-center rounded-full active:bg-bg-mute"
        >
          <ArrowLeft size={20} color="#0A0A0B" />
        </Pressable>

        <View className="items-center">
          <Text className="font-sans-semibold text-[16px] text-fg">
            {screenTitle}
          </Text>
          {shipmentId ? (
            <Text className="font-mono text-[11px] text-fg-3">
              Movo-{shipmentId.slice(0, 8)}
            </Text>
          ) : null}
        </View>

        <View className="h-10 w-10" />
      </View>

      <ScrollView
        contentContainerClassName="px-5 py-6 gap-5"
        keyboardShouldPersistTaps="handled"
      >
        {/* Advertencia si la clave criptográfica del dispositivo no está lista */}
        <HandshakeDeviceKeyWarning
          status={deviceKeyStatus}
          onRetry={retryDeviceKey}
        />

        {/* Carga del Envío */}
        {isLoadingShipment ? (
          <View className="items-center justify-center py-12">
            <ActivityIndicator size="large" />
            <Text className="mt-3 font-sans text-[13px] text-fg-3">
              Cargando datos del envío…
            </Text>
          </View>
        ) : shipmentError ? (
          <ErrorBanner
            testID="handshake-shipment-error"
            message={friendlyErrorMessage(shipmentError, "No pudimos cargar este envío.")}
          />
        ) : (
          /* Tarjeta Principal del QR con Countdown */
          <HandshakeQrCard
            qrPayload={qrPayload}
            secondsLeft={secondsLeft}
            totalSeconds={totalSeconds}
            progressPercent={progressPercent}
            isExpiringSoon={isExpiringSoon}
            isExpired={isExpired}
            isGenerating={qrStatus === "generating"}
            error={qrError}
            counterpartName={counterpartFirstName}
            stage={stage}
            onRegenerate={regenerate}
            onSimulateScan={
              __DEV__
                ? () => {
                    // Simular escaneo confirmando localmente en dev
                    void refetchShipment();
                  }
                : undefined
            }
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
