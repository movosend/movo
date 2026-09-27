import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Image,
  Linking,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useColorScheme } from "nativewind";
import {
  ArrowLeft,
  Check,
  Clock,
  Copy,
  ExternalLink,
  MapPin,
  MessageSquare,
  Package,
  Phone,
  RefreshCw,
  ShieldCheck,
  Star,
} from "lucide-react-native";
import { useShipment } from "../../../../src/hooks/use-shipments";
import { usePublicProfile } from "../../../../src/hooks/use-profile";
import { useLivePosition } from "../../../../src/hooks/use-live-position";
import { LiveMap } from "../../../../components/tracking/live-map";
import { useThemeColors } from "../../../../src/hooks/use-theme-colors";

const SCREEN_HEIGHT = Dimensions.get("window").height;

// Datos de demostración (Stitch Mockup)
const DEMO_CARRIER_POSITION = {
  lat: -31.3850,
  lng: -64.2250,
  capturedAt: new Date().toISOString(),
};

const DEMO_DESTINATION = {
  lat: -31.9140,
  lng: -63.6820,
};

const DEMO_DRIVER = {
  id: "demo-driver-lucas",
  name: "Lucas Benítez",
  photoUrl:
    "https://lh3.googleusercontent.com/aida-public/AB6AXuBXCUbBu19TRuaYeyHbv-_454UfHzDYughrAP5wfwvb_0dI1Ls8dui00pCQccEEMYednH7JLO8-1WYkLdR1dms96O1IxrH-ejU0kLg0nAwtAgIdZQT0F5le06PWmIZAynrsQdIu46RbTkvh-VMZZO1T2Z3dUHT8e7ou0yZj97Pu2Ax8hpPLnq6N9LaaPC8t401A9CnrBSKHCCqTxjQ1h5mavAfVjTVW-RarDLAxPEfwvueIn5xjEB7r",
  phone: "+5493512345678",
  rating: 4.9,
  tripsCount: 124,
};

/**
 * Pantalla de Seguimiento en Vivo para Emisor y Receptor (MOVO-204).
 *
 * Cumple con:
 * - ADR-023: Sin trazas históricas ni polilíneas pasadas del transportista.
 * - Stitch Design: Hero ETA Card, Conductor unificado con badges y contacto, Información de paquete y destino copiable.
 * - Bottom Sheet interactivo deslizable con PanResponder idéntico al del transportista (MOVO-207).
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
    refetch: refetchShipment,
  } = useShipment(demoMode ? undefined : shipmentId);

  // Perfil del transportista
  const carrierId = demoMode ? DEMO_DRIVER.id : shipment?.carrierId ?? undefined;
  const { data: carrierProfile } = usePublicProfile(carrierId);

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
    isStale,
    isDelivered,
    distanceKm,
    estimatedArrivalMinutes,
    lastUpdateText,
    isLoadingInitial,
  } = useLivePosition(demoMode ? undefined : shipmentId, {
    destination,
    enabled: Boolean(shipmentId) || demoMode,
    demo: demoMode,
  });

  const displayPosition = demoMode ? (livePosition ?? DEMO_CARRIER_POSITION) : livePosition;
  const displayCarrierName = demoMode
    ? DEMO_DRIVER.name
    : carrierProfile?.fullName || "Transportista";

  // Alturas para el bottom sheet deslizable
  const EXPANDED_HEIGHT = Math.round(SCREEN_HEIGHT - (topInset + 64));
  const COLLAPSED_HEIGHT = Math.max(Math.round(SCREEN_HEIGHT * 0.38), 290);

  const [isExpanded, setIsExpanded] = useState(false);
  const [copiedCodeToast, setCopiedCodeToast] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  // Animación de arrastre con PanResponder (idéntica a route/index.tsx)
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

  const handleToggleExpand = useCallback(() => {
    const nextState = !isExpandedRef.current;
    animateTo(nextState ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT, nextState);
  }, [EXPANDED_HEIGHT, COLLAPSED_HEIGHT, animateTo]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_, gestureState) => {
          return Math.abs(gestureState.dy) > 3;
        },
        onMoveShouldSetPanResponderCapture: (_, gestureState) => {
          return Math.abs(gestureState.dy) > 3;
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
    [COLLAPSED_HEIGHT, EXPANDED_HEIGHT, animateTo, sheetHeightAnim]
  );

  // Copiar código de seguimiento
  const trackingCode = demoMode
    ? "MV-28491"
    : shipment?.id
      ? `MV-${shipment.id.slice(0, 6).toUpperCase()}`
      : "MV-MOVO";

  const handleCopyCode = () => {
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      void Clipboard.setStringAsync(trackingCode);
      setCopiedCodeToast(true);
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
      toastTimerRef.current = setTimeout(() => {
        setCopiedCodeToast(false);
        toastTimerRef.current = null;
      }, 2000);
    } catch { }
  };

  // Abrir destino en Google Maps
  const handleOpenMaps = () => {
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const query = encodeURIComponent(
        demoMode
          ? "San Martin 450, Oncativo, Cordoba"
          : shipment?.deliveryAddress ?? ""
      );
      const url = `https://www.google.com/maps/search/?api=1&query=${query}`;
      void Linking.openURL(url);
    } catch { }
  };

  // Contactar por llamada
  const handleCallCarrier = () => {
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const phone = demoMode ? DEMO_DRIVER.phone : "";
      if (phone) {
        void Linking.openURL(`tel:${phone}`);
      }
    } catch { }
  };

  // Contactar por mensaje / chat
  const handleMessageCarrier = () => {
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      // Navegación futura a chat o modal
    } catch { }
  };

  // Cálculo de hora ETA para Hero Card
  const now = new Date();
  const etaMinutes = demoMode ? 22 : estimatedArrivalMinutes ?? 20;
  const etaTime = new Date(now.getTime() + etaMinutes * 60000);
  const etaTimeString = `${String(etaTime.getHours()).padStart(2, "0")}:${String(
    etaTime.getMinutes()
  ).padStart(2, "0")}`;

  const displayDistance = demoMode ? 18.4 : distanceKm ?? 15.0;

  return (
    <View className="flex-1 bg-bg">
      {/* 1. Barra Superior Flotante (Stitch design header) */}
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
          <Text className="font-sans-bold text-[15px] text-fg leading-tight">
            Seguimiento en Vivo
          </Text>
          <View className="flex-row items-center gap-1.5 mt-0.5">
            <Text className="font-mono text-[11.5px] font-semibold text-fg-3">
              #{trackingCode}
            </Text>
            <Text className="text-fg-3 text-[10px]">·</Text>
            <View className="flex-row items-center gap-1">
              <View
                className={`h-1.5 w-1.5 rounded-full ${isStale ? "bg-amber-500" : "bg-[#C6F24A]"
                  }`}
              />
              <Text className="font-sans-bold text-[10px] uppercase tracking-wider text-fg-2">
                {isStale ? "Señal pausada" : "Telemetría activa"}
              </Text>
            </View>
          </View>
        </View>

        {demoMode && (
          <Pressable
            testID="btn-exit-demo"
            onPress={() => setDemoMode(false)}
            className="h-8 px-3 rounded-full border border-border bg-bg items-center justify-center flex-none active:scale-95"
            accessibilityRole="button"
            accessibilityLabel="Salir de modo demo"
          >
            <Text className="font-sans-medium text-[11.5px] text-fg">Salir demo</Text>
          </Pressable>
        )}
      </View>

      {/* 2. Mapa Táctico de Fondo (Sin traza histórica según ADR-023) */}
      <View style={StyleSheet.absoluteFill}>
        <LiveMap
          carrierPosition={displayPosition}
          destinationLocation={destination}
          carrierName={(displayCarrierName || "Transportista").split(" ")[0]}
          trackingStatus={trackingStatus}
          lastUpdateText={lastUpdateText}
          topOffset={topInset + 68}
          bottomOffset={isExpanded ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT}
          showControls={!isExpanded}
        />
      </View>

      {/* 3. Toast de Código Copiado */}
      {copiedCodeToast && (
        <View
          testID="copied-code-toast"
          style={{
            position: "absolute",
            top: topInset + 72,
            alignSelf: "center",
            zIndex: 40,
            backgroundColor: isDark
              ? "rgba(17, 17, 19, 0.94)"
              : "rgba(255, 255, 255, 0.94)",
            borderWidth: 1,
            borderColor: isDark
              ? "rgba(255, 255, 255, 0.12)"
              : "rgba(10, 10, 11, 0.08)",
            borderRadius: 9999,
            paddingHorizontal: 16,
            paddingVertical: 8,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.15,
            shadowRadius: 10,
            elevation: 6,
          }}
        >
          <View className="h-2 w-2 rounded-full bg-[#C6F24A]" />
          <Text className="font-sans-semibold text-[12px] text-fg">
            Código #{trackingCode} copiado al portapapeles
          </Text>
        </View>
      )}

      {/* 4. Bottom Sheet Deslizable con PanResponder */}
      <Animated.View
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
          shadowColor: "#000",
          shadowOffset: { width: 0, height: -6 },
          shadowOpacity: 0.14,
          shadowRadius: 18,
          elevation: 12,
          overflow: "hidden",
        }}
      >
        {/* Manija de Arrastre (Handle Bar) */}
        <View
          {...panResponder.panHandlers}
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

        {/* Contenido con Scroll de las tarjetas del diseño de Stitch */}
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingBottom: insets.bottom + 24,
            gap: 12,
          }}
        >
          {/* TARJETA 1: Hero ETA Card */}
          <View
            testID="card-hero-eta"
            className="p-4 rounded-2xl border border-border bg-bg-mute shadow-sm"
          >
            <View className="flex-row items-start justify-between">
              <View className="flex-1 pr-2">
                <Text className="font-sans-bold text-[11px] uppercase tracking-wider text-fg-3">
                  Llegada estimada
                </Text>
                <View className="flex-row items-baseline gap-2 mt-1">
                  <Text className="font-sans-bold text-[28px] text-fg tracking-tight leading-none">
                    {etaTimeString}
                  </Text>
                  <View className="px-2.5 py-0.5 rounded-full bg-bg border border-border">
                    <Text className="font-sans-semibold text-[13px] text-fg">
                      ~{etaMinutes} min
                    </Text>
                  </View>
                </View>
                <Text className="font-sans-medium text-[12px] text-fg-2 mt-1.5">
                  {displayDistance} km hacia destino final
                </Text>
              </View>

              <View className="h-11 w-11 rounded-xl bg-bg border border-border items-center justify-center flex-none">
                <Clock size={22} color={colors.fg1} />
              </View>
            </View>

            {/* Barra de progreso sutil verde lima */}
            <View className="w-full bg-border h-1.5 rounded-full mt-3.5 overflow-hidden">
              <View
                style={{ width: "68%" }}
                className="h-full rounded-full bg-[#C6F24A]"
              />
            </View>
          </View>

          {/* TARJETA 2: Conductor Verificado & Acciones */}
          <View
            testID="card-driver-info"
            className="p-4 rounded-2xl border border-border bg-bg-mute shadow-sm gap-3.5"
          >
            <View className="flex-row items-center gap-3">
              {/* Avatar con badge verificado */}
              <View className="relative flex-none">
                <View className="w-13 h-13 rounded-full overflow-hidden bg-bg border border-border w-[52px] h-[52px] items-center justify-center">
                  {demoMode || carrierProfile?.photoUrl ? (
                    <Image
                      source={{
                        uri: demoMode
                          ? DEMO_DRIVER.photoUrl
                          : carrierProfile?.photoUrl ?? "",
                      }}
                      style={{ width: "100%", height: "100%" }}
                      resizeMode="cover"
                    />
                  ) : (
                    <Text className="font-sans-bold text-[16px] text-fg">
                      {displayCarrierName
                        .split(" ")
                        .map((n) => n[0])
                        .slice(0, 2)
                        .join("")}
                    </Text>
                  )}
                </View>
                {/* Badge Verificado Verde Lima */}
                <View
                  style={{
                    position: "absolute",
                    bottom: -1,
                    right: -1,
                    width: 18,
                    height: 18,
                    borderRadius: 9,
                    backgroundColor: "#C6F24A",
                    alignItems: "center",
                    justifyContent: "center",
                    borderWidth: 2,
                    borderColor: isDark ? "#18181B" : "#FFFFFF",
                  }}
                >
                  <Check size={11} color="#0A0A0B" strokeWidth={3} />
                </View>
              </View>

              {/* Datos del conductor */}
              <View className="flex-1 min-w-0">
                <Text
                  numberOfLines={1}
                  className="font-sans-semibold text-[16px] text-fg"
                >
                  {displayCarrierName}
                </Text>
                <View className="flex-row items-center gap-1 mt-0.5">
                  <Star size={13} color="#F59E0B" fill="#F59E0B" />
                  <Text className="font-sans-semibold text-[12.5px] text-fg">
                    {demoMode ? DEMO_DRIVER.rating : "4.9"}
                  </Text>
                  <Text className="text-fg-3 text-[12px]">·</Text>
                  <Text className="font-sans text-[12px] text-fg-3">
                    ({demoMode ? DEMO_DRIVER.tripsCount : 124} viajes)
                  </Text>
                </View>
              </View>
            </View>

            {/* Fila de Contacto (Botones Mensaje y Llamar) */}
            <View className="flex-row gap-2 pt-1">
              <Pressable
                testID="btn-message-driver"
                onPress={handleMessageCarrier}
                className="flex-1 h-11 px-4 rounded-xl bg-ink-950 items-center justify-center flex-row gap-2 shadow-sm active:scale-[0.98]"
                accessibilityRole="button"
                accessibilityLabel="Enviar mensaje al conductor"
              >
                <MessageSquare size={17} color="#FFFFFF" strokeWidth={2.2} />
                <Text className="font-sans-semibold text-[14px] text-white">
                  Mensaje
                </Text>
              </Pressable>

              <Pressable
                testID="btn-call-driver"
                onPress={handleCallCarrier}
                className="h-11 px-4 rounded-xl bg-bg border border-border items-center justify-center flex-row gap-1.5 active:scale-[0.98]"
                accessibilityRole="button"
                accessibilityLabel="Llamar al conductor"
              >
                <Phone size={16} color={colors.fg1} strokeWidth={2.2} />
                <Text className="font-sans-medium text-[14px] text-fg">
                  Llamar
                </Text>
              </Pressable>
            </View>
          </View>

          {/* TARJETA 3: Información de Paquete & Destino */}
          <View
            testID="card-package-and-destination"
            className="p-4 rounded-2xl border border-border bg-bg-mute shadow-sm divide-y divide-border"
          >
            {/* Ítem & Código */}
            <View className="pb-3.5 flex-row items-center justify-between gap-3">
              <View className="flex-row items-center gap-3 flex-1 min-w-0">
                <View className="w-10 h-10 rounded-xl bg-bg border border-border items-center justify-center flex-none">
                  <Package size={20} color={colors.fg1} />
                </View>
                <View className="flex-1 min-w-0">
                  <Text
                    numberOfLines={1}
                    className="font-sans-semibold text-[14px] text-fg"
                  >
                    {demoMode
                      ? "Notebook + Accesorios"
                      : shipment?.description || "Paquete estándar"}
                  </Text>
                  <Text className="font-sans text-[12px] text-fg-3 mt-0.5">
                    {demoMode ? "2.4 kg" : `${shipment?.weightKg ?? 1.5} kg`}
                  </Text>
                </View>
              </View>

              <Pressable
                testID="btn-copy-tracking-code"
                onPress={handleCopyCode}
                className="flex-row items-center gap-1 px-2.5 py-1.5 rounded-lg bg-bg border border-border active:scale-95 flex-none"
                accessibilityRole="button"
                accessibilityLabel="Copiar código de seguimiento"
              >
                <Text className="font-mono text-[11.5px] font-semibold text-fg">
                  #{trackingCode}
                </Text>
                <Copy size={13} color={colors.fg2} />
              </Pressable>
            </View>

            {/* Punto de Destino */}
            <View className="pt-3.5 flex-row items-center justify-between gap-3">
              <View className="flex-row items-center gap-3 flex-1 min-w-0">
                <View className="w-10 h-10 rounded-xl bg-bg border border-border items-center justify-center flex-none">
                  <MapPin size={20} color={colors.fg1} />
                </View>
                <View className="flex-1 min-w-0">
                  <Text className="font-sans-bold text-[10px] uppercase tracking-wider text-fg-3">
                    Punto de Destino
                  </Text>
                  <Text
                    numberOfLines={1}
                    className="font-sans-semibold text-[13.5px] text-fg mt-0.5"
                  >
                    {demoMode
                      ? "San Martín 450, Oncativo"
                      : shipment?.deliveryAddress || "Destino indicado"}
                  </Text>
                  <Text className="font-sans text-[11.5px] text-fg-3">
                    {demoMode ? "Córdoba · CP 5986" : "Entrega en puerta"}
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
            <Text className="font-sans text-[11px] text-fg-3 flex-1 leading-relaxed">
              Ubicación en tiempo real activa únicamente durante el trayecto activo.
              No se almacenan trazas de recorrido pasadas.
            </Text>
          </View>
        </ScrollView>
      </Animated.View>
    </View>
  );
}
