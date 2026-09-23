import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import {
  ArrowLeft,
  CheckCircle2,
  KeyRound,
  LayoutGrid,
  MapPin,
  Navigation,
  Play,
  Plus,
  QrCode,
  RefreshCw,
  Route,
  ShieldAlert,
  Sparkles,
  Square,
  Wifi,
  WifiOff,
} from "lucide-react-native";
import { locationService, type TrackingStatus } from "../../src/location/location-service";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

/**
 * Pantalla central de atajos de desarrollo (solo visible en __DEV__).
 * Agrupa simuladores de tracking en vivo (MOVO-203), recorrido demo de ruta,
 * estados bloqueantes de KYC, handshake QR y galerías de UI.
 */
export default function DevShortcutsScreen() {
  const colors = useThemeColors();
  const [trackingStatus, setTrackingStatus] = useState<TrackingStatus>(() =>
    locationService.getStatus()
  );
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    return locationService.subscribe(setTrackingStatus);
  }, []);

  if (!__DEV__) {
    return null;
  }

  const handleToggleTracking = async () => {
    setIsProcessing(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      if (trackingStatus.isTracking) {
        await locationService.stopTracking();
      } else {
        await locationService.startTracking(["shipment-dev-demo"]);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSimulateOfflinePosition = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    locationService.enqueuePosition({
      shipmentId: "shipment-dev-demo",
      lat: -31.4167 + (Math.random() - 0.5) * 0.01,
      lng: -64.1833 + (Math.random() - 0.5) * 0.01,
      accuracyM: 10 + Math.round(Math.random() * 8),
      capturedAt: new Date().toISOString(),
    });
  };

  const handleFlushQueue = async () => {
    setIsProcessing(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await locationService.flushQueue();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <View className="flex-1 bg-bg">
      <SafeAreaView className="border-b border-border bg-bg-sub" edges={["top"]}>
        <View className="flex-row items-center gap-3 px-4 py-3">
          <Pressable
            testID="dev-shortcuts-back-btn"
            onPress={() => router.back()}
            hitSlop={10}
            className="h-9 w-9 items-center justify-center rounded-full border border-border bg-bg"
            accessibilityRole="button"
            accessibilityLabel="Volver"
          >
            <ArrowLeft size={18} color={colors.fg1} />
          </Pressable>
          <View className="flex-1">
            <View className="flex-row items-center gap-1.5">
              <Sparkles size={16} color="#2BB673" />
              <Text className="font-sans-bold text-[17px] text-fg">
                Atajos de desarrollo
              </Text>
            </View>
            <Text className="font-sans text-[12px] text-fg-3">
              Herramientas de simulación (Solo en modo __DEV__)
            </Text>
          </View>
        </View>
      </SafeAreaView>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* SECCIÓN 1: SEGUIMIENTO Y UBICACIÓN (MOVO-203) */}
        <View className="mb-6 rounded-[16px] border border-border bg-bg-sub p-4">
          <View className="mb-3 flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <View className="h-8 w-8 items-center justify-center rounded-full bg-lime-500/15">
                <Navigation size={16} color="#2BB673" />
              </View>
              <View>
                <Text className="font-sans-semibold text-[15px] text-fg">
                  Emisión de ubicación (MOVO-203)
                </Text>
                <Text className="font-sans text-[11px] text-fg-3">
                  Simulación de tracking GPS y cola offline
                </Text>
              </View>
            </View>

            <View
              className={`rounded-full px-2.5 py-1 ${
                trackingStatus.isTracking ? "bg-lime-500/20" : "bg-bg-mute"
              }`}
            >
              <Text
                className={`font-sans-semibold text-[11px] ${
                  trackingStatus.isTracking ? "text-lime-500" : "text-fg-3"
                }`}
              >
                {trackingStatus.isTracking ? "TRANSMITIENDO" : "DETENIDO"}
              </Text>
            </View>
          </View>

          {/* Estadísticas en vivo */}
          <View className="mb-4 rounded-[12px] border border-border bg-bg p-3">
            <View className="flex-row justify-between py-1">
              <Text className="font-sans text-[12px] text-fg-3">Envíos monitoreados</Text>
              <Text className="font-sans-medium text-[12px] text-fg">
                {trackingStatus.activeShipmentIds.length > 0
                  ? trackingStatus.activeShipmentIds.join(", ")
                  : "Ninguno"}
              </Text>
            </View>
            <View className="flex-row justify-between py-1">
              <Text className="font-sans text-[12px] text-fg-3">Cola offline pendiente</Text>
              <Text
                className={`font-sans-medium text-[12px] ${
                  trackingStatus.pendingQueueCount > 0 ? "text-amber-500" : "text-fg"
                }`}
              >
                {trackingStatus.pendingQueueCount} posiciones
              </Text>
            </View>
            <View className="flex-row justify-between py-1">
              <Text className="font-sans text-[12px] text-fg-3">Último reporte exitoso</Text>
              <Text className="font-sans-medium text-[12px] text-fg">
                {trackingStatus.lastReportedAt
                  ? new Date(trackingStatus.lastReportedAt).toLocaleTimeString()
                  : "Sin reportes aún"}
              </Text>
            </View>
            {trackingStatus.lastError && (
              <View className="flex-row justify-between py-1">
                <Text className="font-sans text-[12px] text-danger-500">Último error</Text>
                <Text className="font-sans-medium text-[12px] text-danger-500">
                  {trackingStatus.lastError}
                </Text>
              </View>
            )}
          </View>

          {/* Botones de acción de tracking */}
          <View className="gap-2.5">
            <Pressable
              testID="dev-toggle-tracking-btn"
              disabled={isProcessing}
              onPress={handleToggleTracking}
              className={`flex-row items-center justify-center gap-2 rounded-[12px] py-3 ${
                trackingStatus.isTracking
                  ? "border border-danger-500/50 bg-danger-500/10"
                  : "bg-lime-500"
              }`}
            >
              {isProcessing ? (
                <ActivityIndicator size="small" color={trackingStatus.isTracking ? "#E5484D" : "#0A0A0B"} />
              ) : trackingStatus.isTracking ? (
                <>
                  <Square size={16} color="#E5484D" />
                  <Text className="font-sans-semibold text-[14px] text-danger-500">
                    Detener tracking simulado
                  </Text>
                </>
              ) : (
                <>
                  <Play size={16} color="#0A0A0B" />
                  <Text className="font-sans-semibold text-[14px] text-ink-950">
                    Iniciar tracking simulado (dev-shipment-demo)
                  </Text>
                </>
              )}
            </Pressable>

            <View className="flex-row gap-2">
              <Pressable
                testID="dev-enqueue-offline-btn"
                onPress={handleSimulateOfflinePosition}
                className="flex-1 flex-row items-center justify-center gap-1.5 rounded-[10px] border border-border bg-bg py-2.5"
              >
                <Plus size={14} color={colors.fg1} />
                <Text className="font-sans-medium text-[12px] text-fg">
                  Encolar offline (+1)
                </Text>
              </Pressable>

              <Pressable
                testID="dev-flush-queue-btn"
                disabled={isProcessing || trackingStatus.pendingQueueCount === 0}
                onPress={handleFlushQueue}
                className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-[10px] border border-border py-2.5 ${
                  trackingStatus.pendingQueueCount > 0 ? "bg-bg" : "bg-bg-mute opacity-50"
                }`}
              >
                <RefreshCw size={14} color={colors.fg1} />
                <Text className="font-sans-medium text-[12px] text-fg">
                  Drenar cola
                </Text>
              </Pressable>
            </View>
          </View>

          <Text className="mt-3 text-center font-sans text-[11px] text-fg-3">
            💡 Al iniciar el tracking, visitá Inicio o Mi Transporte para ver la pill flotante activa.
          </Text>
        </View>

        {/* SECCIÓN 2: RUTAS Y RECORRIDO */}
        <View className="mb-6 rounded-[16px] border border-border bg-bg-sub p-4">
          <View className="mb-3 flex-row items-center gap-2">
            <View className="h-8 w-8 items-center justify-center rounded-full bg-lime-500/15">
              <Route size={16} color="#2BB673" />
            </View>
            <View>
              <Text className="font-sans-semibold text-[15px] text-fg">
                Ruta Optimizada (Demo)
              </Text>
              <Text className="font-sans text-[11px] text-fg-3">
                Polilínea Córdoba → Villa María con waypoints y paradas
              </Text>
            </View>
          </View>

          <Pressable
            testID="dev-route-demo-btn"
            onPress={() => router.push("/route?demo=true" as any)}
            className="flex-row items-center justify-center gap-2 rounded-[12px] border border-border bg-bg py-3"
          >
            <Route size={16} color={colors.fg1} />
            <Text className="font-sans-medium text-[13.5px] text-fg">
              Abrir recorrido demo en el mapa
            </Text>
          </Pressable>
        </View>

        {/* SECCIÓN 3: IDENTIDAD Y KYC */}
        <View className="mb-6 rounded-[16px] border border-border bg-bg-sub p-4">
          <View className="mb-3 flex-row items-center gap-2">
            <View className="h-8 w-8 items-center justify-center rounded-full bg-amber-500/15">
              <ShieldAlert size={16} color="#F59E0B" />
            </View>
            <View>
              <Text className="font-sans-semibold text-[15px] text-fg">
                Identidad y KYC
              </Text>
              <Text className="font-sans text-[11px] text-fg-3">
                Simulación de pantallas bloqueantes
              </Text>
            </View>
          </View>

          <View className="gap-2">
            <Pressable
              testID="dev-kyc-manual-review-btn"
              onPress={() =>
                router.push({
                  pathname: "/kyc",
                  params: { status: "manual_review" },
                } as any)
              }
              className="flex-row items-center justify-between rounded-[12px] border border-border bg-bg px-4 py-3"
            >
              <Text className="font-sans-medium text-[13px] text-fg">
                Pantalla DNI en revisión (manual_review)
              </Text>
              <Text className="font-sans text-[12px] text-lime-500">Abrir →</Text>
            </Pressable>

            <Pressable
              testID="dev-license-kyc-btn"
              onPress={() =>
                router.push({
                  pathname: "/license-kyc",
                  params: { status: "manual_review" },
                } as any)
              }
              className="flex-row items-center justify-between rounded-[12px] border border-border bg-bg px-4 py-3"
            >
              <Text className="font-sans-medium text-[13px] text-fg">
                Pantalla Licencia en revisión
              </Text>
              <Text className="font-sans text-[12px] text-lime-500">Abrir →</Text>
            </Pressable>
          </View>
        </View>

        {/* SECCIÓN 4: OPERACIONES Y DEBUG */}
        <View className="rounded-[16px] border border-border bg-bg-sub p-4">
          <View className="mb-3 flex-row items-center gap-2">
            <View className="h-8 w-8 items-center justify-center rounded-full bg-blue-500/15">
              <QrCode size={16} color="#3B82F6" />
            </View>
            <View>
              <Text className="font-sans-semibold text-[15px] text-fg">
                Operaciones y Diagnóstico
              </Text>
              <Text className="font-sans text-[11px] text-fg-3">
                Handshake, tokens y conexión
              </Text>
            </View>
          </View>

          <View className="gap-2">
            <Pressable
              testID="dev-handshake-btn"
              onPress={() => router.push("/dev-handshake" as any)}
              className="flex-row items-center justify-between rounded-[12px] border border-border bg-bg px-4 py-3"
            >
              <Text className="font-sans-medium text-[13px] text-fg">
                Simulador de Handshake QR
              </Text>
              <Text className="font-sans text-[12px] text-lime-500">Abrir →</Text>
            </Pressable>

            <Pressable
              testID="dev-home-operativo-btn"
              onPress={() => router.push("/dev-home-operativo" as any)}
              className="flex-row items-center justify-between rounded-[12px] border border-border bg-bg px-4 py-3"
            >
              <Text className="font-sans-medium text-[13px] text-fg">
                Galería de estados de Home Operativo
              </Text>
              <Text className="font-sans text-[12px] text-lime-500">Abrir →</Text>
            </Pressable>

            <Pressable
              testID="dev-tokens-btn"
              onPress={() => router.push("/dev-tokens" as any)}
              className="flex-row items-center justify-between rounded-[12px] border border-border bg-bg px-4 py-3"
            >
              <Text className="font-sans-medium text-[13px] text-fg">
                Tokens y Clave del Dispositivo
              </Text>
              <Text className="font-sans text-[12px] text-lime-500">Abrir →</Text>
            </Pressable>

            <Pressable
              testID="dev-connection-btn"
              onPress={() => router.push("/dev-connection" as any)}
              className="flex-row items-center justify-between rounded-[12px] border border-border bg-bg px-4 py-3"
            >
              <Text className="font-sans-medium text-[13px] text-fg">
                Diagnóstico de API y Conexión
              </Text>
              <Text className="font-sans text-[12px] text-lime-500">Abrir →</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
