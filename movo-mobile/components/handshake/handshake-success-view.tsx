import React, { useEffect } from "react";
import { Pressable, Text, View } from "react-native";
import { Check, ArrowLeft, Home } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { ShipmentSummary } from "../../src/api/shipments-client";
import { shipmentStatusLabel } from "../../src/lib/shipment-format";

export interface HandshakeSuccessViewProps {
  shipment: ShipmentSummary;
  stage: "pickup" | "delivery" | null;
  onBackToShipment: () => void;
  onGoHome: () => void;
  testID?: string;
}

export function HandshakeSuccessView({
  shipment,
  stage,
  onBackToShipment,
  onGoHome,
  testID = "handshake-success-view",
}: HandshakeSuccessViewProps) {
  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

  const isPickup = stage === "pickup";

  const title = isPickup ? "Retiro confirmado" : "Entrega confirmada";
  const body = isPickup
    ? "La transferencia de custodia se completó con éxito. El paquete está en manos del transportista y en tránsito."
    : "El paquete fue entregado y la custodia transferida correctamente. ¡Muchas gracias!";

  return (
    <View testID={testID} className="flex-1 justify-between px-5 pt-8 pb-10">
      <View className="items-center gap-6">
        {/* Badge circular con Checkmark (Claude Design) */}
        <View
          testID="handshake-success-badge"
          className="h-[68px] w-[68px] items-center justify-center rounded-full bg-lime-500 shadow-md"
        >
          <Check size={36} color="#0A0A0B" strokeWidth={3} />
        </View>

        {/* Título y Descripción */}
        <View className="items-center gap-2 px-2 text-center">
          <Text className="text-center font-sans-semibold text-[26px] tracking-tight text-fg">
            {title}
          </Text>
          <Text className="text-center font-sans text-[15px] leading-relaxed text-fg-2">
            {body}
          </Text>
        </View>

        {/* Tarjeta de Resumen */}
        <View className="w-full max-w-[420px] rounded-[12px] border border-border bg-bg-elevated px-4 py-1 shadow-sm">
          <View className="flex-row items-center justify-between border-b border-border/60 py-3">
            <Text className="font-sans text-[12px] text-fg-3">Envío</Text>
            <Text className="font-mono text-[13px] font-medium text-fg">
              Movo-{shipment.id.slice(0, 8)}
            </Text>
          </View>

          <View className="flex-row items-center justify-between border-b border-border/60 py-3">
            <Text className="font-sans text-[12px] text-fg-3">Estado</Text>
            <Text className="font-sans-medium text-[13px] text-lime-600 dark:text-lime-400">
              {shipmentStatusLabel(shipment.status)}
            </Text>
          </View>

          <View className="flex-row items-center justify-between py-3">
            <Text className="font-sans text-[12px] text-fg-3">Etapa</Text>
            <Text className="font-sans-medium text-[13px] text-fg">
              {isPickup ? "Retiro completado" : "Entrega completada"}
            </Text>
          </View>
        </View>
      </View>

      {/* Botones de Acción Inferiores */}
      <View className="w-full max-w-[420px] self-center gap-3">
        <Pressable
          testID="handshake-success-back"
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onBackToShipment();
          }}
          className="w-full flex-row items-center justify-center gap-2 rounded-lg bg-fg py-3.5 active:opacity-85"
        >
          <ArrowLeft size={16} color="#FFFFFF" />
          <Text className="font-sans-semibold text-[14px] text-bg">
            Volver al detalle del envío
          </Text>
        </Pressable>

        <Pressable
          testID="handshake-success-home"
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onGoHome();
          }}
          className="w-full flex-row items-center justify-center gap-2 rounded-lg border border-border bg-bg-elevated py-3 active:opacity-85"
        >
          <Home size={16} color="#5A5A62" />
          <Text className="font-sans-medium text-[14px] text-fg">
            Ir al inicio
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
