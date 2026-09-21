import React, { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ArrowLeft, Play, Pause, RotateCcw, ShieldCheck, QrCode } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { HandshakeQrCard } from "../handshake/handshake-qr-card";
import { HandshakeSuccessView } from "../handshake/handshake-success-view";
import { HandshakeDeviceKeyWarning } from "../handshake/handshake-device-key-warning";
import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import type { ShipmentSummary } from "../../src/api/shipments-client";

export default function DevHandshakeScreen() {
  const router = useRouter();

  const [stage, setStage] = useState<"pickup" | "delivery">("pickup");
  const [secondsLeft, setSecondsLeft] = useState<number>(15);
  const [isRunning, setIsRunning] = useState<boolean>(true);
  const [isConfirmed, setIsConfirmed] = useState<boolean>(false);
  const [showKeyWarning, setShowKeyWarning] = useState<boolean>(false);
  const [keyStatus, setKeyStatus] = useState<"pending" | "error">("error");

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reloj regresivo en tiempo real
  useEffect(() => {
    if (isRunning && !isConfirmed && secondsLeft > 0) {
      timerRef.current = setInterval(() => {
        setSecondsLeft((prev) => {
          if (prev <= 1) {
            clearInterval(timerRef.current!);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRunning, isConfirmed, secondsLeft]);

  const resetCountdown = (startSecs = 15) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSecondsLeft(startSecs);
    setIsRunning(true);
    setIsConfirmed(false);
  };

  const isExpired = secondsLeft <= 0;
  const isExpiringSoon = secondsLeft <= 5 && secondsLeft > 0;
  const progressPercent = Math.max(0, Math.min(100, (secondsLeft / 15) * 100));

  const demoPayload = JSON.stringify({
    shipmentId: "shp-demo-48213",
    nonce: `nonce-live-${secondsLeft}`,
    signature: "base64_device_signed_mock_signature_movo159",
  });

  const dummyShipment: ShipmentSummary = {
    id: "shp-demo-48213-abcd",
    senderId: "u-sender-1",
    carrierId: "u-carrier-2",
    receiverId: "u-receiver-3",
    status: stage === "pickup" ? ShipmentStatus.IN_TRANSIT : ShipmentStatus.DELIVERED,
    packageType: "standard_package",
    weightKg: 2.5,
    lengthCm: 25,
    widthCm: 20,
    heightCm: 15,
    description: "Caja mediana de prueba",
    urgent: false,
    pickupAddress: "Av. Colón 1200, Córdoba",
    pickupLat: -31.42,
    pickupLng: -64.18,
    deliveryAddress: "Bv. San Juan 450, Córdoba",
    deliveryLat: -31.41,
    deliveryLng: -64.19,
    pickupDate: "2026-09-20",
    pickupTimeWindowStart: "09:00",
    pickupTimeWindowEnd: "12:00",
    suggestedPriceArs: 4800,
    agreedPriceArs: 5000,
    paymentMethod: null,
    lastStatusChangedAt: null,
    deliveredAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Si está confirmado, mostrar pantalla de éxito
  if (isConfirmed) {
    return (
      <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
        <View className="flex-row items-center justify-between border-b border-border px-4 py-3">
          <Pressable
            onPress={() => setIsConfirmed(false)}
            hitSlop={8}
            className="flex-row items-center gap-1.5"
          >
            <ArrowLeft size={18} color="#0A0A0B" />
            <Text className="font-sans-medium text-[13px] text-fg">Volver a los controles dev</Text>
          </Pressable>
          <View className="rounded-full bg-lime-100 px-2.5 py-0.5 dark:bg-lime-950/40">
            <Text className="font-sans-semibold text-[10px] text-lime-800 dark:text-lime-300">
              Éxito (Dev)
            </Text>
          </View>
        </View>

        <HandshakeSuccessView
          shipment={dummyShipment}
          stage={stage}
          onBackToShipment={() => setIsConfirmed(false)}
          onGoHome={() => router.back()}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      {/* Header Dev */}
      <View className="border-b border-border bg-bg-sub px-4 py-3">
        <View className="flex-row items-center justify-between mb-2">
          <Pressable onPress={() => router.back()} hitSlop={8} className="flex-row items-center gap-1.5">
            <ArrowLeft size={20} color="#0A0A0B" />
            <Text className="font-sans-medium text-[14px] text-fg">Volver</Text>
          </Pressable>
          <View className="flex-row items-center gap-1 rounded-full bg-lime-500/20 px-2.5 py-1">
            <QrCode size={12} color="#4D7C0F" />
            <Text className="font-sans-semibold text-[11px] text-lime-800 dark:text-lime-300">
              MOVO-159 Preview
            </Text>
          </View>
        </View>
        <Text className="font-sans-semibold text-[16px] text-fg">
          Generador de QR Handshake (Demo)
        </Text>
      </View>

      <ScrollView contentContainerClassName="px-5 py-5 gap-5" keyboardShouldPersistTaps="handled">
        {/* Panel de Control Interactivo de Dev */}
        <View className="gap-3 rounded-xl border border-border bg-bg-elevated p-3.5 shadow-sm">
          <Text className="font-sans-semibold text-[11px] uppercase tracking-wider text-fg-3">
            Controles de prueba
          </Text>

          {/* Selector de Etapa (Retiro vs Entrega) */}
          <View className="flex-row gap-2">
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setStage("pickup");
              }}
              className={`flex-1 items-center justify-center rounded-lg py-2 border ${stage === "pickup" ? "bg-ink-950 border-ink-950" : "bg-bg border-border"}`}
            >
              <Text
                className={`font-sans-medium text-[12px] ${stage === "pickup" ? "text-paper" : "text-fg-2"}`}
              >
                1. Retiro (Emisor)
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setStage("delivery");
              }}
              className={`flex-1 items-center justify-center rounded-lg py-2 border ${stage === "delivery" ? "bg-ink-950 border-ink-950" : "bg-bg border-border"}`}
            >
              <Text
                className={`font-sans-medium text-[12px] ${stage === "delivery" ? "text-paper" : "text-fg-2"}`}
              >
                2. Entrega (Transportista)
              </Text>
            </Pressable>
          </View>

          {/* Salto rápido a estados del countdown */}
          <View className="flex-row items-center gap-1.5 pt-1">
            <Pressable
              onPress={() => resetCountdown(15)}
              className="flex-1 items-center justify-center rounded-md bg-bg-mute py-1.5 border border-border"
            >
              <Text className="font-sans text-[11px] text-fg">15s (Inicio)</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setSecondsLeft(4);
                setIsRunning(true);
              }}
              className="flex-1 items-center justify-center rounded-md bg-red-50 dark:bg-red-950/30 py-1.5 border border-red-200 dark:border-red-800"
            >
              <Text className="font-sans text-[11px] text-red-600 font-medium">4s (Rojo)</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setSecondsLeft(0);
                setIsRunning(false);
              }}
              className="flex-1 items-center justify-center rounded-md bg-neutral-200 dark:bg-neutral-800 py-1.5 border border-border"
            >
              <Text className="font-sans text-[11px] text-fg-2 font-medium">0s (Expirado)</Text>
            </Pressable>
          </View>

          {/* Botones de Timer (Play, Pausa, Reset) */}
          <View className="flex-row items-center gap-2 pt-1">
            <Pressable
              onPress={() => setIsRunning(!isRunning)}
              className="flex-1 flex-row items-center justify-center gap-1.5 rounded-lg bg-bg py-2 border border-border"
            >
              {isRunning ? <Pause size={14} color="#0A0A0B" /> : <Play size={14} color="#0A0A0B" />}
              <Text className="font-sans-medium text-[12px] text-fg">
                {isRunning ? "Pausar reloj" : "Reanudar reloj"}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => resetCountdown(15)}
              className="flex-1 flex-row items-center justify-center gap-1.5 rounded-lg bg-bg py-2 border border-border"
            >
              <RotateCcw size={14} color="#0A0A0B" />
              <Text className="font-sans-medium text-[12px] text-fg">Reiniciar (15s)</Text>
            </Pressable>
          </View>

          {/* Botón simular confirmación */}
          <Pressable
            onPress={() => {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              setIsConfirmed(true);
            }}
            className="w-full flex-row items-center justify-center gap-2 rounded-lg bg-lime-500 py-2.5 active:opacity-85"
          >
            <ShieldCheck size={16} color="#0A0A0B" />
            <Text className="font-sans-semibold text-[13px] text-ink-950">
              Simular escaneo de receptor → Pantalla de Éxito
            </Text>
          </Pressable>

          {/* Toggle de advertencia de clave */}
          <Pressable
            onPress={() => setShowKeyWarning(!showKeyWarning)}
            className="pt-1 flex-row items-center justify-between"
          >
            <Text className="font-sans text-[11px] text-fg-3">
              {showKeyWarning ? "Ocultar advertencia de clave" : "Probar advertencia de clave de dispositivo"}
            </Text>
            <Text className="font-sans-semibold text-[11px] text-lime-700 dark:text-lime-400">
              {showKeyWarning ? "Activa" : "Inactiva"}
            </Text>
          </Pressable>
        </View>

        {/* Advertencia de clave de dispositivo (si está activa) */}
        {showKeyWarning ? (
          <HandshakeDeviceKeyWarning
            status={keyStatus}
            onRetry={() => {
              setKeyStatus("pending");
              setTimeout(() => setKeyStatus("error"), 1500);
            }}
          />
        ) : null}

        {/* Tarjeta de QR con countdown */}
        <HandshakeQrCard
          qrPayload={demoPayload}
          secondsLeft={secondsLeft}
          totalSeconds={15}
          progressPercent={progressPercent}
          isExpiringSoon={isExpiringSoon}
          isExpired={isExpired}
          isGenerating={false}
          stage={stage}
          counterpartName={stage === "pickup" ? "Lucas Conductor" : "Mariana Destinataria"}
          onRegenerate={() => resetCountdown(15)}
          onSimulateScan={() => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            setIsConfirmed(true);
          }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
