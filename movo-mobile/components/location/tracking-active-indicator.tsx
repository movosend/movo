import { AlertCircle, ChevronRight, Navigation, WifiOff, type LucideIcon } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useCarrierTracking } from "../../src/hooks/use-carrier-tracking";
import { TrackingPermissionModal } from "./tracking-permission-modal";

export type TrackingPillVariant = "live" | "permission" | "background" | "offline";

const PILL_COPY: Record<TrackingPillVariant, { title: string; detail: string; a11y: string }> = {
  live: {
    title: "En vivo",
    detail: "Tu ubicación está siendo compartida",
    a11y: "En vivo. Tu ubicación está siendo compartida con las partes de tus envíos.",
  },
  permission: {
    title: "Ubicación desactivada",
    detail: "Tocá para activarla",
    a11y: "Permiso de ubicación requerido. Tocá para activar.",
  },
  background: {
    title: "Solo con la app abierta",
    detail: "Tocá para activar en segundo plano",
    a11y: "Transmitiendo solo con app abierta. Tocá para activar en segundo plano.",
  },
  offline: {
    title: "Sin conexión",
    detail: "Se envía al reconectar",
    a11y: "Sin conexión a internet. Tu ubicación se envía cuando vuelva la conexión.",
  },
};

/**
 * Todos los estados con el mismo estilo que "En vivo" (fondo neutro, título en el color del texto): lo que cambia es
 * el ícono, de color. Antes cada estado tenía su fondo y su título tintados y el pie de la tarjeta se veía como una
 * franja de colores.
 */
const PILL_TONE: Record<TrackingPillVariant, { container: string; inline: string; title: string; iconHex: string }> = {
  live: { container: "border-border bg-bg-sub", inline: "border-border", title: "text-fg", iconHex: "#84CC16" },
  permission: {
    container: "border-border bg-bg-sub active:bg-bg-mute",
    inline: "border-border active:bg-bg-mute",
    title: "text-fg",
    iconHex: "#F59E0B",
  },
  background: {
    container: "border-border bg-bg-sub active:bg-bg-mute",
    inline: "border-border active:bg-bg-mute",
    title: "text-fg",
    iconHex: "#0EA5E9",
  },
  offline: { container: "border-border bg-bg-sub", inline: "border-border", title: "text-fg", iconHex: "#3B82F6" },
};

const PILL_ICON: Record<TrackingPillVariant, LucideIcon | null> = {
  live: null,
  permission: AlertCircle,
  background: Navigation,
  offline: WifiOff,
};

const PULSE_DURATION_MS = 1600;

/** Punto lima con un anillo que se expande y se desvanece en loop; quieto con "reducir movimiento". */
function LivePulseDot() {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) return;
    progress.value = withRepeat(withTiming(1, { duration: PULSE_DURATION_MS, easing: Easing.out(Easing.ease) }), -1, false);
  }, [progress, reduceMotion]);

  const ringStyle = useAnimatedStyle(() => ({
    opacity: reduceMotion ? 0.35 : 0.6 * (1 - progress.value),
    transform: [{ scale: reduceMotion ? 1.6 : 1 + progress.value * 1.4 }],
  }));

  return (
    <View testID="tracking-live-dot" className="h-2 w-2 items-center justify-center">
      <Animated.View className="absolute h-2 w-2 rounded-full bg-lime-500" style={ringStyle} />
      <View className="h-2 w-2 rounded-full bg-lime-500" />
    </View>
  );
}

/**
 * La parte visual del aviso, sin estado ni tracking: la usa `TrackingActiveIndicator` y la galería de atajos de
 * desarrollador para mostrar los cuatro estados. Con `onPress` se puede tocar (lleva chevron).
 */
export function TrackingStatusPill({
  testID = "tracking-active-indicator",
  variant,
  layout = "banner",
  className,
  onPress,
}: {
  testID?: string;
  variant: TrackingPillVariant;
  layout?: "banner" | "inline";
  className?: string;
  onPress?: () => void;
}) {
  const copy = PILL_COPY[variant];
  const tone = PILL_TONE[variant];
  const Icon = PILL_ICON[variant];
  const isInteractive = onPress !== undefined;

  return (
    // Una sola línea a todo el ancho (feedback de TestFlight: el banner de dos líneas se veía pesado).
    <Pressable
      testID={testID}
      disabled={!isInteractive}
      onPress={onPress}
      accessibilityRole={isInteractive ? "button" : "text"}
      accessibilityLabel={copy.a11y}
      className={`w-full flex-row items-center gap-2.5 px-3.5 py-2.5 ${
        layout === "inline" ? `border-t ${tone.inline}` : `rounded-xl border ${tone.container}`
      } ${className ?? (layout === "inline" ? "" : "mb-5")}`}
    >
      {Icon ? <Icon size={14} color={tone.iconHex} strokeWidth={2.2} /> : <LivePulseDot />}
      <Text numberOfLines={1} className="flex-1 text-[13px]">
        <Text testID={`${testID}-status-text`} className={`font-sans-semibold ${tone.title}`}>
          {copy.title}
        </Text>
        <Text className="font-sans text-fg-2">{` · ${copy.detail}`}</Text>
      </Text>
      {isInteractive ? <ChevronRight size={14} color={tone.iconHex} strokeWidth={2.2} /> : null}
    </Pressable>
  );
}

export interface TrackingActiveIndicatorProps {
  testID?: string;
  className?: string;
  /**
   * `banner` (default): tarjeta suelta, a todo el ancho. `inline`: pie de otra tarjeta (el viaje en curso de Inicio),
   * con un separador arriba y sin borde propio.
   */
  variant?: "banner" | "inline";
}

/**
 * Indicador visual meramente informativo de tracking activo para el transportista (MOVO-203, AC8; MOVO-242).
 * Muestra el estado en tiempo real de la emisión de ubicación, la falta de conexión o
 * la degradación funcional a foreground cuando falta permiso en segundo plano (AC3).
 * Si faltan permisos de ubicación, permite tocar para abrir el modal explicativo respectivo.
 */
export function TrackingActiveIndicator({
  testID = "tracking-active-indicator",
  className,
  variant: layout = "banner",
}: TrackingActiveIndicatorProps) {
  const {
    isTracking,
    inTransitCount,
    pendingQueueCount,
    deliveryFailing,
    permissionGranted,
    backgroundPermissionGranted,
    lastError,
    requestPermission,
    requestBackgroundPermission,
  } = useCarrierTracking();

  const [modalStage, setModalStage] = useState<"foreground" | "background">("foreground");
  const [permissionModalVisible, setPermissionModalVisible] = useState(false);

  // Si no hay envíos en camino y no hay tracking activo, no se muestra nada
  if (inTransitCount === 0 && pendingQueueCount === 0 && !isTracking) {
    return null;
  }

  const isForegroundDenied = permissionGranted === false || lastError === "PERMISSION_DENIED";
  const isBackgroundMissing =
    !isForegroundDenied && isTracking && backgroundPermissionGranted === false;

  // MOVO-346 (punto 13): "sin conexión" sale de un envío que falló por red, no de que la cola tenga
  // ítems: una cola con restos o vaciándose no es falta de conexión.
  const isOffline = deliveryFailing;

  const isInteractive = isForegroundDenied || isBackgroundMissing;

  const handlePress = () => {
    if (isForegroundDenied) {
      setModalStage("foreground");
      setPermissionModalVisible(true);
    } else if (isBackgroundMissing) {
      setModalStage("background");
      setPermissionModalVisible(true);
    }
  };

  const handleModalAccept = async () => {
    setPermissionModalVisible(false);
    if (modalStage === "foreground") {
      await requestPermission();
    } else {
      await requestBackgroundPermission();
    }
  };

  const variant: TrackingPillVariant = isForegroundDenied
    ? "permission"
    : isBackgroundMissing
      ? "background"
      : isOffline
        ? "offline"
        : "live";

  return (
    <>
      <TrackingStatusPill
        testID={testID}
        variant={variant}
        layout={layout}
        className={className}
        onPress={isInteractive ? handlePress : undefined}
      />

      {/* Modal explicativo de permisos en dos etapas */}
      <TrackingPermissionModal
        visible={permissionModalVisible}
        stage={modalStage}
        onAccept={handleModalAccept}
        onDismiss={() => setPermissionModalVisible(false)}
      />
    </>
  );
}
