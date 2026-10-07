import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Linking,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useColorScheme } from "nativewind";
import {
  ArrowLeft,
  Clock,
  ExternalLink,
  MapPin,
  Package,
  ShieldCheck,
} from "lucide-react-native";
import { useShipment } from "../../../../src/hooks/use-shipments";
import { useLivePosition } from "../../../../src/hooks/use-live-position";
import { LiveMap } from "../../../../components/tracking/live-map";
import { CounterpartCard } from "../../../../components/shipments/counterpart-card";
import { activeShipmentDisplayCode } from "../../../../src/lib/active-shipment-format";
import { useThemeColors } from "../../../../src/hooks/use-theme-colors";

const SCREEN_HEIGHT = Dimensions.get("window").height;

// Datos de demostración
const DEMO_CARRIER_POSITION = {
  lat: -31.385,
  lng: -64.225,
  capturedAt: new Date().toISOString(),
};

const DEMO_DESTINATION = {
  lat: -31.914,
  lng: -63.682,
};

const COLLAPSED_HEIGHT = 220;
const EXPANDED_HEIGHT = Math.min(Math.round(SCREEN_HEIGHT * 0.65), 520);

/**
 * Pantalla de Seguimiento en Vivo para Emisor y Receptor (MOVO-204).
 *
 * Cumple con:
 * - ADR-023: Sin trazas históricas ni polilíneas pasadas del transportista.
 * - Bottom Sheet deslizable plano con PanResponder sin conflicto de scroll.
 * - Single source of truth para la telemetría en la pastilla del mapa.
 */
export default function LiveTrackingScreen() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const topInset = insets?.top ?? 48;
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";

  const { id: rawId, demo } = useLocalSearchParams<{ id?: string; demo?: string }>();
  const shipmentId = Array.isArray(rawId) ? rawId[0] : rawId;
  const [demoMode, setDemoMode] = useState(() => Boolean(demo === "true"));

  // Consulta del envío
  const {
    data: shipment,
    isLoading: isLoadingShipment,
  } = useShipment(demoMode ? undefined : shipmentId);

  // Destino
  const destination = useMemo(() => {
    if (demoMode) return DEMO_DESTINATION;
    if (shipment?.deliveryLat && shipment?.deliveryLng) {
      return {
        lat: shipment.deliveryLat,
        lng: shipment.deliveryLng,
      };
    }
    return null;
  }, [demoMode, shipment]);

  // Hook de posición en tiempo real
  const {
    position: livePosition,
    trackingStatus,
    isDelivered,
    distanceKm,
    estimatedArrivalMinutes,
    lastUpdateText,
  } = useLivePosition(demoMode ? undefined : shipmentId, {
    destination,
    enabled: Boolean(shipmentId) || demoMode,
    demo: demoMode,
  });

  const displayPosition = demoMode ? (livePosition ?? DEMO_CARRIER_POSITION) : livePosition;

  const [isExpanded, setIsExpanded] = useState(false);

  // Animación de arrastre con PanResponder sobre todo el sheet
  const sheetHeightAnim = useRef(new Animated.Value(COLLAPSED_HEIGHT)).current;
  const isExpandedRef = useRef(isExpanded);
  isExpandedRef.current = isExpanded;
  const currentHeightRef = useRef(COLLAPSED_HEIGHT);
  const dragStartHeightRef = useRef(COLLAPSED_HEIGHT);

  useEffect(() => {
    const animId = sheetHeightAnim.addListener(({ value }) => {
      currentHeightRef.current = value;
    });
    return () => {
      sheetHeightAnim.removeListener(animId);
    };
  }, [sheetHeightAnim]);

  const animateTo = useCallback(
    (toHeight: number, expandState: boolean) => {
      setIsExpanded(expandState);
      try {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch { }
      Animated.spring(sheetHeightAnim, {
        toValue: toHeight,
        tension: 65,
        friction: 11,
        useNativeDriver: false,
      }).start();
    },
    [sheetHeightAnim]
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_, gestureState) => {
          return Math.abs(gestureState.dy) > 4;
        },
        onMoveShouldSetPanResponderCapture: (_, gestureState) => {
          return Math.abs(gestureState.dy) > 4;
        },
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          sheetHeightAnim.stopAnimation();
          dragStartHeightRef.current = currentHeightRef.current;
        },
        onPanResponderMove: (_, gestureState) => {
          const newHeight = dragStartHeightRef.current - gestureState.dy;
          const clamped = Math.min(
            Math.max(newHeight, COLLAPSED_HEIGHT - 30),
            EXPANDED_HEIGHT + 30
          );
          sheetHeightAnim.setValue(clamped);
        },
        onPanResponderRelease: (_, gestureState) => {
          const movedUp = gestureState.dy < -25 || gestureState.vy < -0.25;
          const movedDown = gestureState.dy > 25 || gestureState.vy > 0.25;

          let shouldExpand = isExpandedRef.current;
          if (!isExpandedRef.current && movedUp) {
            shouldExpand = true;
          } else if (isExpandedRef.current && movedDown) {
            shouldExpand = false;
          } else {
            const midpoint = (COLLAPSED_HEIGHT + EXPANDED_HEIGHT) / 2;
            shouldExpand = currentHeightRef.current > midpoint;
          }

          animateTo(shouldExpand ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT, shouldExpand);
        },
        onPanResponderTerminate: () => {
          animateTo(
            isExpandedRef.current ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT,
            isExpandedRef.current
          );
        },
      }),
    [animateTo, sheetHeightAnim]
  );

  // Abrir destino en Google Maps con lat,lng precisos
  const handleOpenMaps = () => {
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const lat = destination?.lat ?? (demoMode ? DEMO_DESTINATION.lat : 0);
      const lng = destination?.lng ?? (demoMode ? DEMO_DESTINATION.lng : 0);
      const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
      void Linking.openURL(url);
    } catch { }
  };

  // Cálculo de hora ETA para Hero Card
  const now = new Date();
  const etaMinutes = demoMode ? 22 : estimatedArrivalMinutes;
  const etaTimeString = etaMinutes != null
    ? (() => {
        const etaDate = new Date(now.getTime() + etaMinutes * 60000);
        return `${String(etaDate.getHours()).padStart(2, "0")}:${String(
          etaDate.getMinutes()
        ).padStart(2, "0")}`;
      })()
    : "—";

  const displayDistance = demoMode ? 18.4 : distanceKm;
  const trackingCode = demoMode ? "MV-28491" : activeShipmentDisplayCode(shipment?.id ?? shipmentId ?? "");

  // Estados de carga y error si no es modo demo
  if (!demoMode && isLoadingShipment) {
    return (
      <SafeAreaView className="flex-1 bg-bg items-center justify-center">
        <Text className="font-sans-medium text-body text-fg-2">Cargando seguimiento...</Text>
      </SafeAreaView>
    );
  }

  if (!demoMode && !shipment) {
    return (
      <SafeAreaView className="flex-1 bg-bg p-6 items-center justify-center gap-4">
        <Text className="font-sans-semibold text-h3 text-fg">Envío no disponible</Text>
        <Text className="font-sans text-body text-fg-2 text-center">
          No se encontró la información de este envío.
        </Text>
        <Pressable
          onPress={() => router.back()}
          className="px-5 py-2.5 rounded-lg bg-fg active:opacity-90"
        >
          <Text className="font-sans-semibold text-body text-bg">Volver</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <View className="flex-1 bg-bg">
      {/* 1. Barra Superior Flotante */}
      <View
        testID="tracking-header"
        style={{
          position: "absolute",
          top: topInset + 6,
          left: 16,
          right: 16,
          zIndex: 25,
          minHeight: 52,
          paddingHorizontal: 14,
          paddingVertical: 8,
          borderRadius: 16,
          backgroundColor: isDark
            ? "rgba(17, 17, 19, 0.94)"
            : "rgba(255, 255, 255, 0.94)",
          borderWidth: 1,
          borderColor: isDark
            ? "rgba(255, 255, 255, 0.12)"
            : "rgba(10, 10, 11, 0.08)",
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.15,
          shadowRadius: 20,
          elevation: 6,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
        }}
      >
        <Pressable
          testID="btn-back-tracking"
          onPress={() => router.back()}
          className="h-9 w-9 rounded-full border border-border bg-bg items-center justify-center flex-none active:scale-95"
          accessibilityRole="button"
          accessibilityLabel="Volver al detalle del envío"
        >
          <ArrowLeft size={18} color={colors.fg1} />
        </Pressable>

        <View className="flex-1 min-w-0 justify-center">
          <Text className="font-sans-semibold text-h3 text-fg leading-tight">
            Seguimiento en vivo
          </Text>
          <Text className="font-mono-semibold text-caption text-fg-3 mt-0.5">
            {trackingCode}
          </Text>
        </View>

        {demoMode && (
          <Pressable
            testID="btn-exit-demo"
            onPress={() => router.back()}
            className="h-8 px-3 rounded-full border border-border bg-bg items-center justify-center flex-none active:scale-95"
            accessibilityRole="button"
            accessibilityLabel="Salir de modo demo"
          >
            <Text className="font-sans-medium text-caption text-fg">Salir demo</Text>
          </Pressable>
        )}
      </View>

      {/* 2. Mapa Táctico de Fondo (Sin traza histórica según ADR-023) */}
      <View style={StyleSheet.absoluteFill}>
        <LiveMap
          carrierPosition={displayPosition}
          destinationLocation={destination}
          carrierName="Transportista"
          trackingStatus={trackingStatus}
          lastUpdateText={lastUpdateText}
          topOffset={topInset + 68}
          bottomOffset={isExpanded ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT}
          showControls={!isExpanded}
        />
      </View>

      {/* 3. Overlay si el envío ya fue entregado (AC8 / ADR-023) */}
      {isDelivered && (
        <View
          testID="tracking-delivered-overlay"
          style={{
            position: "absolute",
            top: topInset + 68,
            left: 16,
            right: 16,
            zIndex: 35,
          }}
          className="p-5 rounded-2xl bg-bg border border-border items-center gap-3"
        >
          <Text className="font-sans-semibold text-h3 text-fg">Envío entregado</Text>
          <Text className="font-sans text-small text-fg-2 text-center">
            El paquete fue entregado y el seguimiento en vivo ha concluido.
          </Text>
          <Pressable
            // `dismissTo` (MOVO-271): se llega desde el detalle; `replace` lo duplicaba.
            onPress={() => router.dismissTo(`/(app)/shipments/${shipmentId}`)}
            className="px-5 py-2.5 rounded-lg bg-fg active:opacity-90"
          >
            <Text className="font-sans-semibold text-small text-bg">Ver detalle del envío</Text>
          </Pressable>
        </View>
      )}

      {/* 4. Bottom Sheet Deslizable con PanResponder */}
      <Animated.View
        {...panResponder.panHandlers}
        testID="tracking-bottom-sheet"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: sheetHeightAnim,
          zIndex: 30,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          borderTopWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.bg,
          overflow: "hidden",
        }}
      >
        {/* Manija de Arrastre (Handle Bar) */}
        <View
          testID="tracking-sheet-handle"
          className="w-full pt-3 pb-2 items-center justify-center bg-transparent"
        >
          <View
            style={{
              width: 38,
              height: 4.5,
              borderRadius: 3,
              backgroundColor: isDark
                ? "rgba(255, 255, 255, 0.22)"
                : "rgba(10, 10, 11, 0.18)",
            }}
          />
        </View>

        {/* Contenido sin Scroll interno: arrastrar mueve el sheet entero */}
        <View className="px-4 pb-6 gap-3">
          {/* TARJETA 1: Hero ETA Card */}
          <View
            testID="card-hero-eta"
            className="p-4 rounded-2xl border border-border bg-bg-mute"
          >
            <View className="flex-row items-start justify-between">
              <View className="flex-1 pr-2">
                <Text className="font-sans-semibold text-caption uppercase text-fg-3">
                  Llegada estimada
                </Text>
                <View className="flex-row items-baseline gap-2 mt-1">
                  <Text className="font-sans-semibold text-title text-fg tracking-tight leading-none">
                    {etaTimeString}
                  </Text>
                  <View className="px-2.5 py-0.5 rounded-full bg-bg border border-border">
                    <Text className="font-sans-semibold text-small text-fg">
                      {etaMinutes != null ? `~${etaMinutes} min (aprox.)` : "Calculando…"}
                    </Text>
                  </View>
                </View>
                <Text className="font-sans-medium text-small text-fg-2 mt-1.5">
                  {displayDistance != null
                    ? `${displayDistance} km hacia destino final`
                    : "Calculando distancia…"}
                </Text>
              </View>

              <View className="h-10 w-10 rounded-xl bg-bg border border-border items-center justify-center flex-none">
                <Clock size={20} color={colors.fg1} />
              </View>
            </View>
          </View>

          {/* TARJETA 2: Conductor */}
          {shipment?.carrierId ? (
            <View testID="card-driver-info" className="p-4 rounded-2xl border border-border bg-bg-mute">
              <Text className="font-sans-semibold text-caption uppercase text-fg-3 mb-2">
                Transportista
              </Text>
              <CounterpartCard
                userId={shipment.carrierId}
                onPress={() => router.push(`/profile/${shipment.carrierId}`)}
              />
            </View>
          ) : demoMode ? (
            <View testID="card-driver-info" className="p-4 rounded-2xl border border-border bg-bg-mute">
              <Text className="font-sans-semibold text-caption uppercase text-fg-3 mb-2">
                Transportista
              </Text>
              <View className="flex-row items-center gap-3">
                <View className="h-10 w-10 rounded-full bg-border items-center justify-center">
                  <Text className="font-sans-semibold text-body text-fg">LB</Text>
                </View>
                <View>
                  <Text className="font-sans-semibold text-body text-fg">Lucas Benítez</Text>
                  <Text className="font-sans text-small text-fg-2">Transportista asignado</Text>
                </View>
              </View>
            </View>
          ) : null}

          {/* TARJETA 3: Información de Paquete & Destino */}
          <View
            testID="card-package-and-destination"
            className="p-4 rounded-2xl border border-border bg-bg-mute divide-y divide-border"
          >
            {/* Ítem & Código */}
            <View className="pb-3 flex-row items-center justify-between gap-3">
              <View className="flex-row items-center gap-3 flex-1 min-w-0">
                <View className="w-9 h-9 rounded-xl bg-bg border border-border items-center justify-center flex-none">
                  <Package size={18} color={colors.fg1} />
                </View>
                <View className="flex-1 min-w-0">
                  <Text numberOfLines={1} className="font-sans-semibold text-body text-fg">
                    {demoMode
                      ? "Notebook + Accesorios"
                      : shipment?.description || "Paquete estándar"}
                  </Text>
                  {shipment?.weightKg != null && (
                    <Text className="font-sans text-caption text-fg-3 mt-0.5">
                      {shipment.weightKg} kg
                    </Text>
                  )}
                </View>
              </View>

              <Text className="font-mono-semibold text-mono text-fg-2">
                {trackingCode}
              </Text>
            </View>

            {/* Destino */}
            <View className="pt-3 flex-row items-center justify-between gap-3">
              <View className="flex-row items-center gap-3 flex-1 min-w-0">
                <View className="w-9 h-9 rounded-xl bg-bg border border-border items-center justify-center flex-none">
                  <MapPin size={18} color={colors.fg1} />
                </View>
                <View className="flex-1 min-w-0">
                  <Text className="font-sans-semibold text-caption uppercase text-fg-3">
                    Destino
                  </Text>
                  <Text numberOfLines={1} className="font-sans-semibold text-small text-fg mt-0.5">
                    {demoMode
                      ? "San Martín 450, Oncativo"
                      : shipment?.deliveryAddress || "Destino indicado"}
                  </Text>
                </View>
              </View>

              <Pressable
                testID="btn-open-destination-maps"
                onPress={handleOpenMaps}
                className="w-9 h-9 rounded-lg bg-bg border border-border items-center justify-center flex-none active:scale-95"
                accessibilityRole="button"
                accessibilityLabel="Abrir dirección en Google Maps"
              >
                <ExternalLink size={15} color={colors.fg2} />
              </Pressable>
            </View>
          </View>

          {/* Banner de Privacidad (ADR-023) */}
          <View
            testID="banner-privacy-adr023"
            className="flex-row items-start gap-2.5 p-3 rounded-xl bg-bg border border-border/70"
          >
            <ShieldCheck size={16} color="#71717A" className="mt-0.5 flex-none" />
            <Text className="font-sans text-caption text-fg-3 flex-1 leading-relaxed">
              Solo ves la ubicación actual del transportista mientras el envío está en curso. El recorrido no se muestra; se guarda 30 días únicamente para resolver disputas.
            </Text>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}
