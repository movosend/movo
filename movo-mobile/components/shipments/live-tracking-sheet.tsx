import * as Haptics from "expo-haptics";
import { Clock, ShieldCheck } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Dimensions, PanResponder, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useShipmentChatUnread } from "../../src/hooks/use-shipment-chat-unread";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import type { LiveArrivalEstimate } from "../../src/lib/live-route-lines";
import { formatDuration, formatTimeOfDay } from "../../src/lib/time-format";
import { ShipmentChatButton } from "./shipment-chat-button";
import { CounterpartCard } from "./counterpart-card";

const SCREEN_HEIGHT = Dimensions.get("window").height;
export const LIVE_SHEET_COLLAPSED_HEIGHT = 200;
const EXPANDED_HEIGHT = Math.min(Math.round(SCREEN_HEIGHT * 0.6), 460);

export const LIVE_TRACKING_PRIVACY_TEXT =
  "Ves la ubicación del transportista y el recorrido de tu envío solo mientras está en curso. Al terminar dejan de mostrarse; el recorrido se guarda 30 días únicamente para resolver disputas.";

export interface LiveTrackingSheetProps {
  shipmentId: string;
  estimate: LiveArrivalEstimate;
  /** La posición inicial todavía se está pidiendo: "Calculando…" solo mientras tanto. */
  estimateLoading?: boolean;
  carrierId: string | null;
  /** `null`: sin chat (no debería pasar con transportista asignado, pero no se inventa el botón). */
  chat: "open" | "read_only" | null;
  /** Navegar desde el sheet: el caller cierra la pantalla completa antes (el modal taparía la ruta). */
  onNavigate: (path: string) => void;
  /** Alto actual del sheet, para que el mapa no encuadre debajo. */
  onHeightChange?: (height: number) => void;
  testID?: string;
}

/**
 * Bottom sheet del seguimiento a pantalla completa (MOVO-361): lo que antes tenía la pantalla
 * "Seguimiento en vivo" — llegada estimada y km, el transportista con acceso al chat y el aviso de
 * privacidad (DD-023) — sobre el mismo mapa del detalle. Se arrastra entre dos alturas; el
 * PanResponder es el de esa pantalla, que ya convivía con los gestos del mapa.
 */
export function LiveTrackingSheet({
  shipmentId,
  estimate,
  estimateLoading = false,
  carrierId,
  chat,
  onNavigate,
  onHeightChange,
  testID = "live-tracking-sheet",
}: LiveTrackingSheetProps) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const collapsedHeight = LIVE_SHEET_COLLAPSED_HEIGHT + insets.bottom;
  const expandedHeight = EXPANDED_HEIGHT + insets.bottom;
  const unread = useShipmentChatUnread(shipmentId, chat);

  const [isExpanded, setIsExpanded] = useState(false);
  const heightAnim = useRef(new Animated.Value(collapsedHeight)).current;
  const isExpandedRef = useRef(isExpanded);
  isExpandedRef.current = isExpanded;
  const currentHeightRef = useRef(collapsedHeight);
  const dragStartHeightRef = useRef(collapsedHeight);

  useEffect(() => {
    onHeightChange?.(isExpanded ? expandedHeight : collapsedHeight);
  }, [isExpanded, expandedHeight, collapsedHeight, onHeightChange]);

  useEffect(() => {
    const id = heightAnim.addListener(({ value }) => {
      currentHeightRef.current = value;
    });
    return () => heightAnim.removeListener(id);
  }, [heightAnim]);

  const animateTo = useCallback(
    (expand: boolean) => {
      setIsExpanded(expand);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      Animated.spring(heightAnim, {
        toValue: expand ? expandedHeight : collapsedHeight,
        tension: 65,
        friction: 11,
        useNativeDriver: false,
      }).start();
    },
    [heightAnim, expandedHeight, collapsedHeight],
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 4,
        onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dy) > 4,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          heightAnim.stopAnimation();
          dragStartHeightRef.current = currentHeightRef.current;
        },
        onPanResponderMove: (_, g) => {
          const next = dragStartHeightRef.current - g.dy;
          heightAnim.setValue(Math.min(Math.max(next, collapsedHeight - 30), expandedHeight + 30));
        },
        onPanResponderRelease: (_, g) => {
          const movedUp = g.dy < -25 || g.vy < -0.25;
          const movedDown = g.dy > 25 || g.vy > 0.25;
          let expand: boolean;
          if (!isExpandedRef.current && movedUp) expand = true;
          else if (isExpandedRef.current && movedDown) expand = false;
          else expand = currentHeightRef.current > (collapsedHeight + expandedHeight) / 2;
          animateTo(expand);
        },
        onPanResponderTerminate: () => animateTo(isExpandedRef.current),
      }),
    [animateTo, heightAnim, collapsedHeight, expandedHeight],
  );

  return (
    <Animated.View
      {...panResponder.panHandlers}
      testID={testID}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: heightAnim,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        borderTopWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.bg,
        overflow: "hidden",
      }}
    >
      <Pressable
        testID={`${testID}-handle`}
        onPress={() => animateTo(!isExpandedRef.current)}
        accessibilityRole="button"
        accessibilityLabel={isExpanded ? "Achicar el panel" : "Ver más del seguimiento"}
        className="w-full items-center pb-2 pt-3"
      >
        <View className="h-1 w-10 rounded-full bg-border-strong" />
      </Pressable>

      <View className="gap-3 px-4 pb-6">
        <ArrivalCard estimate={estimate} loading={estimateLoading} testID={`${testID}-eta`} />

        {carrierId ? (
          <View testID={`${testID}-carrier`} className="rounded-2xl border border-border bg-bg-mute p-4">
            <Text className="mb-2 font-sans-semibold text-caption uppercase text-fg-3">Transportista</Text>
            <CounterpartCard userId={carrierId} onPress={() => onNavigate(`/profile/${carrierId}`)} />
            {chat ? (
              <ShipmentChatButton
                chat={chat}
                unread={unread}
                layout="block"
                testID={`${testID}-chat`}
                unreadTestID={`${testID}-chat-unread`}
                onPress={() => onNavigate(`/(app)/shipments/${shipmentId}/chat`)}
              />
            ) : null}
          </View>
        ) : null}

        <View
          testID={`${testID}-privacy`}
          className="flex-row items-start gap-2.5 rounded-xl border border-border/70 bg-bg p-3"
        >
          <ShieldCheck size={16} color={colors.fg3} />
          <Text className="flex-1 font-sans text-caption leading-relaxed text-fg-3">{LIVE_TRACKING_PRIVACY_TEXT}</Text>
        </View>
      </View>
    </Animated.View>
  );
}

function ArrivalCard({ estimate, loading, testID }: { estimate: LiveArrivalEstimate; loading: boolean; testID: string }) {
  const colors = useThemeColors();
  if (estimate.kind === "stage") {
    return (
      <View testID={testID} className="rounded-2xl border border-border bg-bg-mute p-4">
        <Text className="font-sans-semibold text-caption uppercase text-fg-3">Seguimiento</Text>
        <Text className="mt-1 font-sans-semibold text-body text-fg">{estimate.text}</Text>
      </View>
    );
  }
  const eta = estimate.kind === "eta" ? estimate : null;
  const etaTime = eta ? formatTimeOfDay(new Date(Date.now() + eta.minutes * 60_000)) : "—";
  const label = eta?.target === "pickup" ? "Llegada estimada al retiro" : "Llegada estimada";
  const kmText = eta
    ? `${eta.km.toLocaleString("es-AR")} km ${eta.target === "pickup" ? "hasta el retiro" : "hasta el destino"}`
    : loading
      ? "Calculando distancia…"
      : "Sin ubicación del transportista";
  return (
    <View testID={testID} className="flex-row items-start justify-between rounded-2xl border border-border bg-bg-mute p-4">
      <View className="flex-1 pr-2">
        <Text className="font-sans-semibold text-caption uppercase text-fg-3">{label}</Text>
        <View className="mt-1 flex-row items-baseline gap-2">
          <Text className="font-sans-semibold text-title leading-none tracking-tight text-fg">{etaTime}</Text>
          <View className="rounded-full border border-border bg-bg px-2.5 py-0.5">
            <Text className="font-sans-semibold text-small text-fg">
              {eta ? `~${formatDuration(eta.minutes)} (aprox.)` : loading ? "Calculando…" : "Sin ubicación"}
            </Text>
          </View>
        </View>
        <Text testID={`${testID}-km`} className="mt-1.5 font-sans-medium text-small text-fg-2">
          {kmText}
        </Text>
      </View>
      <View className="h-10 w-10 flex-none items-center justify-center rounded-xl border border-border bg-bg">
        <Clock size={20} color={colors.fg1} />
      </View>
    </View>
  );
}
