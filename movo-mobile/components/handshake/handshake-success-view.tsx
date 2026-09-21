import React, { useEffect } from "react";
import { Pressable, Text, View } from "react-native";
import { Check, ArrowLeft, Home } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useColorScheme } from "nativewind";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { ShipmentSummary } from "../../src/api/shipments-client";
import { ShipmentStatus } from "@movo/shared/dist/types/shipment";

export interface HandshakeSuccessViewProps {
  shipment: ShipmentSummary;
  stage: "pickup" | "delivery" | null;
  onBackToShipment: () => void;
  onGoHome: () => void;
  testID?: string;
}

/**
 * Pantalla de confirmación de Handshake QR según el diseño y manual de marca Movo
 * (Claude Design artifact 'Viaje del transportista.dc.html' líneas 477-502 y 1025-1035).
 */
export function HandshakeSuccessView({
  shipment,
  stage,
  onBackToShipment,
  onGoHome,
  testID = "handshake-success-view",
}: HandshakeSuccessViewProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = useThemeColors();

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

  const isPickup = stage === "pickup";

  // Colores del badge según Claude Design artifact:
  // Pickup: fondo #0A0A0B (ink-950) con check #C6F24A (lime-500)
  // Delivery: fondo #C6F24A (lime-500) con check #0A0A0B (ink-950)
  const badgeBg = isPickup ? "#0A0A0B" : "#C6F24A";
  const badgeInk = isPickup ? "#C6F24A" : "#0A0A0B";

  const isCompleted = !isPickup && shipment.status === ShipmentStatus.COMPLETED;
  const title = isPickup ? "Retiro confirmado" : "Entrega confirmada";
  const body = isPickup
    ? "Tenés la custodia del paquete. El envío pasó a en tránsito y el emisor ya recibió la notificación."
    : isCompleted
      ? "El envío figura como completado y el pago fue acreditado."
      : "El envío figura como entregado. Estamos procesando el pago; te avisamos cuando se acredite.";

  const statusValue = isPickup ? "En tránsito" : isCompleted ? "Completado" : "Entregado";
  const stageValue = isPickup ? "Retiro completado" : "Entrega completada";

  return (
    <View testID={testID} className="flex-1 justify-between px-5 pt-8 pb-10">
      <View className="items-center gap-6">
        {/* Badge circular con Checkmark */}
        <View
          testID="handshake-success-badge"
          style={{ backgroundColor: badgeBg }}
          className="h-[64px] w-[64px] items-center justify-center rounded-full border border-black/10 shadow-sm dark:border-white/10"
        >
          <Check size={32} color={badgeInk} strokeWidth={2.5} />
        </View>

        {/* Título y Descripción centrados */}
        <View className="items-center gap-2 px-2">
          <Text className="text-center font-sans-semibold text-[26px] leading-[1.2] tracking-tight text-fg">
            {title}
          </Text>
          <Text className="text-center font-sans text-[15px] leading-relaxed text-fg-2">
            {body}
          </Text>
        </View>

        {/* Tabla resumen */}
        <View className="w-full max-w-[420px] rounded-[10px] border border-border bg-bg-sub px-3.5 py-0.5">
          <View className="flex-row items-center justify-between border-b border-border/60 py-3">
            <Text className="font-sans text-[12px] text-fg-3">Envío</Text>
            <Text className="font-mono text-[13px] font-medium text-fg">
              Movo-{shipment.id.slice(0, 8)}
            </Text>
          </View>

          <View className="flex-row items-center justify-between border-b border-border/60 py-3">
            <Text className="font-sans text-[12px] text-fg-3">Estado</Text>
            <Text className="font-sans-medium text-[13px] text-fg">
              {statusValue}
            </Text>
          </View>

          <View className="flex-row items-center justify-between py-3">
            <Text className="font-sans text-[12px] text-fg-3">Etapa</Text>
            <Text className="font-sans-medium text-[13px] text-fg">
              {stageValue}
            </Text>
          </View>
        </View>
      </View>

      {/* CTAs Inferiores */}
      <View className="w-full max-w-[420px] self-center gap-2.5">
        <Pressable
          testID="handshake-success-back"
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onBackToShipment();
          }}
          className="h-[52px] w-full flex-row items-center justify-center gap-2 rounded-lg bg-ink-950 active:opacity-85 dark:bg-lime-500"
        >
          <ArrowLeft size={16} color={isDark ? "#0A0A0B" : "#FFFFFF"} />
          <Text className="font-sans-semibold text-[15px] text-white dark:text-ink-950">
            Volver al detalle del envío
          </Text>
        </Pressable>

        <Pressable
          testID="handshake-success-home"
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onGoHome();
          }}
          className="h-[46px] w-full flex-row items-center justify-center gap-2 rounded-lg border border-border bg-bg-sub active:opacity-85"
        >
          <Home size={16} color={colors.fg2} />
          <Text className="font-sans-medium text-[14px] text-fg">
            Ir al inicio
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
