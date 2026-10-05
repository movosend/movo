import React, { useEffect, useRef, useState } from "react";
import { AlertCircle, ChevronDown, Package } from "lucide-react-native";
import {
  GestureResponderHandlers,
  LayoutChangeEvent,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, {
  type SharedValue,
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { useColorScheme } from "nativewind";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { CarrierRoute, CarrierRouteStop } from "@movo/shared/dist/types/routing";
import { useStopCounterpartName } from "../../src/hooks/use-stop-counterpart";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import {
  ROUTE_SHEET_BEZIER,
  ROUTE_SHEET_CLOSE_FADE_MS,
  ROUTE_SHEET_DURATION_MS,
  ROUTE_SHEET_FADE_DELAY_MS,
  ROUTE_SHEET_STAGGER_MS,
} from "../../src/lib/route-sheet-motion";
import { NavigateButton } from "./navigate-button";

const LIME = "#C6F24A";
const INK_950 = "#0A0A0B";
const DANGER = "#E5484D";
const EASE = Easing.bezier(...ROUTE_SHEET_BEZIER);

interface StopListProps {
  route: CarrierRoute;
  /** Parada que ocupa la card ancla. Por defecto, la próxima (`activeStopOrder`). */
  selectedStopOrder?: number | null;
  activeStopOrder?: number | null;
  onSelectStop?: (stop: CarrierRouteStop) => void;
  onPressShipment?: (shipmentId: string) => void;
  onPressAction?: (stop: CarrierRouteStop) => void;
  /** Deshabilita el CTA principal de una parada (ej. entrega sin wizard todavía). */
  isActionDisabled?: (stop: CarrierRouteStop) => boolean;
  isRefreshing?: boolean;
  onRefresh?: () => void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  panHandlers?: GestureResponderHandlers;
  /**
   * Alto que necesita el sheet colapsado para mostrar completa la card ancla (sin
   * scroll). Lo mide el propio StopList; el sheet lo usa como altura colapsada.
   */
  onCollapsedHeightChange?: (height: number) => void;
  testID?: string;
}

/**
 * Formatea una duración en minutos al formato horario (ej: 115 -> "1h55min", 45 -> "45 min").
 */
export function formatDuration(minutes: number): string {
  const rounded = Math.round(minutes);
  if (rounded <= 0) return "0 min";
  if (rounded < 60) {
    return `${rounded} min`;
  }
  const hours = Math.floor(rounded / 60);
  const remainingMinutes = rounded % 60;
  if (remainingMinutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h${remainingMinutes}min`;
}

function clockTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * ETA de una parada en versión corta, para las filas compactas ("23:12" o "+1h50min").
 * El encabezado del sheet aclara que todos los horarios son aproximados (AC11).
 */
function formatEtaShort(stop: CarrierRouteStop): string {
  const clock = clockTime(stop.estimatedArrivalAt);
  if (clock) return clock;
  if (stop.estimatedArrivalMinutes > 0) return `+${formatDuration(stop.estimatedArrivalMinutes)}`;
  return "Ahora";
}

/**
 * Formatea el ETA estimado asegurando que se presente siempre como estimación (AC11: "aprox.").
 */
export function formatEstimatedArrival(stop: CarrierRouteStop): string {
  const clock = clockTime(stop.estimatedArrivalAt);
  if (clock) return `${clock} aprox.`;
  if (stop.estimatedArrivalMinutes > 0) {
    return `+${formatDuration(stop.estimatedArrivalMinutes)} aprox.`;
  }
  return "Inmediato aprox.";
}

/**
 * Formatea una franja horaria a partir de ISO string o string de hora ("HH:mm").
 */
function extractHourMinute(instantStr: string | null | undefined): string | null {
  if (!instantStr) return null;
  if (instantStr.includes("T")) return clockTime(instantStr);
  const parts = instantStr.split(":");
  if (parts.length >= 2) {
    return `${parts[0]}:${parts[1]}`;
  }
  return instantStr;
}

export function formatTimeWindow(start?: string | null, end?: string | null): string | null {
  const startFmt = extractHourMinute(start);
  const endFmt = extractHourMinute(end);
  if (startFmt && endFmt) {
    return `${startFmt} – ${endFmt}`;
  }
  if (startFmt) {
    return `Desde ${startFmt}`;
  }
  if (endFmt) {
    return `Hasta ${endFmt}`;
  }
  return null;
}

function stopKindLabel(stop: CarrierRouteStop): string {
  return stop.type === "pickup" ? "Retiro" : "Entrega";
}

/** "Retirás de Julia" / "Entregás a Julia", o la acción sola mientras no hay nombre. */
function counterpartLine(stop: CarrierRouteStop, name: string | null): { verb: string; name: string | null } {
  if (stop.type === "pickup") {
    return name ? { verb: "Retirás de", name } : { verb: "Retirás el paquete", name: null };
  }
  return name ? { verb: "Entregás a", name } : { verb: "Entregás el paquete", name: null };
}

/** Cuánto sobresale el fondo de la card ancla abierta alrededor de su contenido. */
const ANCHOR_CHROME_INSET = 12;
/** Separación entre la card ancla y la fila vecina (deja lugar al fondo que sobresale). */
const ANCHOR_ROW_GAP = ANCHOR_CHROME_INSET + 8;
const ROW_GAP = 8;
/**
 * Aire entre el encabezado y la card ancla. Fijo en los dos estados (cambiarlo al abrir haría
 * saltar la card): con la ruta abierta deja 16px entre "Tu ruta" y el fondo que sobresale.
 */
const CONTENT_PADDING_TOP = ANCHOR_CHROME_INSET + 16;

/**
 * Sheet de paradas de "Mi ruta" (MOVO-207, rediseñado sobre el mockup 2a de Claude Design
 * "Morph desde la parada activa").
 *
 * La card ancla es la parada seleccionada (por defecto la próxima) y nunca se reemplaza:
 * colapsada se ve plana, integrada al sheet; al abrir aparece detrás de ella un fondo con
 * borde lima, y el resto de la ruta se despliega arriba y abajo con un leve escalonado por
 * distancia. Tocar otra parada de la lista la vuelve ancla.
 *
 * El contenido de la card ancla mide siempre lo mismo (el fondo es una capa aparte que
 * sobresale): así el texto no se reacomoda cuadro a cuadro al abrir, y el alto colapsado
 * del sheet no depende de la animación.
 *
 * AC4: orden, tipo, dirección, ventana horaria y ETA de cada parada.
 * AC5: `outsideTimeWindow` se marca explícitamente como "Fuera de ventana".
 * AC6: `route.optimized === false` muestra un aviso de orden por defecto.
 * AC9: "Ver envío" lleva al detalle del envío.
 * AC11: el ETA se presenta siempre como aproximado.
 * MOVO-237: la card ancla ofrece "Navegar" (deep-link a la app de mapas del sistema).
 */
export function StopList({
  route,
  selectedStopOrder,
  activeStopOrder = 1,
  onSelectStop,
  onPressShipment,
  onPressAction,
  isActionDisabled,
  isRefreshing,
  onRefresh,
  isExpanded,
  onToggleExpand,
  panHandlers,
  onCollapsedHeightChange,
  testID = "carrier-stop-list",
}: StopListProps) {
  const colors = useThemeColors();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const insets = useSafeAreaInsets();
  const bottomPadding = Math.max(insets?.bottom ?? 0, 16) + 12;
  const { stops, totalDistanceKm, optimized, disclaimer } = route;

  const [internalExpanded, setInternalExpanded] = useState(false);
  const expanded = isExpanded ?? internalExpanded;
  const handleToggle = onToggleExpand ?? (() => setInternalExpanded((prev) => !prev));

  // Las filas siguen montadas un instante al cerrar para poder apagarse antes de desmontarse.
  const [rowsMounted, setRowsMounted] = useState(expanded);
  useEffect(() => {
    if (expanded) {
      setRowsMounted(true);
      return;
    }
    const timer = setTimeout(() => setRowsMounted(false), ROUTE_SHEET_CLOSE_FADE_MS + 20);
    return () => clearTimeout(timer);
  }, [expanded]);

  // 0 = colapsado, 1 = abierto. Maneja el cruce de encabezados y el fondo de la card ancla.
  const openProgress = useSharedValue(expanded ? 1 : 0);
  useEffect(() => {
    openProgress.value = withTiming(expanded ? 1 : 0, {
      duration: ROUTE_SHEET_DURATION_MS,
      easing: EASE,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  const nextStop = stops.find((s) => s.stopOrder === (activeStopOrder ?? 1)) ?? stops[0];
  const anchorStop =
    stops.find((s) => s.stopOrder === (selectedStopOrder ?? nextStop?.stopOrder)) ?? nextStop;
  const anchorIndex = anchorStop ? stops.indexOf(anchorStop) : 0;
  const anchorIsNext = Boolean(anchorStop && nextStop && anchorStop.stopOrder === nextStop.stopOrder);

  // Alto colapsado = encabezado + card ancla + paddings. Ninguno de los dos cambia con la
  // animación, así que se puede reportar en cualquier momento sin que el sheet persiga un
  // valor que se mueve.
  const [headerHeight, setHeaderHeight] = useState<number | null>(null);
  const [anchorHeight, setAnchorHeight] = useState<number | null>(null);
  useEffect(() => {
    if (headerHeight == null || anchorHeight == null) return;
    onCollapsedHeightChange?.(Math.ceil(headerHeight + CONTENT_PADDING_TOP + anchorHeight + bottomPadding));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headerHeight, anchorHeight, bottomPadding]);

  // Al abrir, si hay paradas antes de la ancla, el scroll la deja donde estaba (las previas
  // quedan arriba, a un scroll). Al cerrar, vuelve arriba de todo.
  const scrollRef = useRef<ScrollView>(null);
  const keepAnchorInPlace = useRef(false);
  useEffect(() => {
    if (expanded) {
      keepAnchorInPlace.current = true;
    } else {
      keepAnchorInPlace.current = false;
      scrollRef.current?.scrollTo?.({ y: 0, animated: true });
    }
  }, [expanded]);

  const handleAnchorLayout = (e: LayoutChangeEvent) => {
    const { height, y } = e.nativeEvent.layout;
    const rounded = Math.round(height);
    setAnchorHeight((prev) => (prev === rounded ? prev : rounded));
    if (keepAnchorInPlace.current && y > CONTENT_PADDING_TOP) {
      scrollRef.current?.scrollTo?.({ y: y - CONTENT_PADDING_TOP, animated: false });
      keepAnchorInPlace.current = false;
    }
  };

  const headerCollapsedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(openProgress.value, [0, 0.55], [1, 0], Extrapolation.CLAMP),
    transform: [{ translateY: interpolate(openProgress.value, [0, 1], [0, -6]) }],
  }));
  const headerExpandedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(openProgress.value, [0.45, 1], [0, 1], Extrapolation.CLAMP),
    transform: [{ translateY: interpolate(openProgress.value, [0, 1], [6, 0]) }],
  }));

  const handleColor = isDark ? "#3A3A40" : "#D5D5DB";
  const headerTitle = anchorStop
    ? `${anchorIsNext ? "Próxima parada" : "Parada"} · ${anchorStop.stopOrder} de ${stops.length}`
    : `${stops.length} paradas`;
  const headerSubtitle = anchorStop
    ? `${anchorStop.estimatedArrivalMinutes > 0 ? `${formatDuration(anchorStop.estimatedArrivalMinutes)} · ` : ""}${formatEstimatedArrival(anchorStop)}`
    : "";
  const routeSummary = `${stops.length} ${stops.length === 1 ? "parada" : "paradas"}${
    totalDistanceKm > 0 ? ` · ${totalDistanceKm.toFixed(1)} km` : ""
  } · horarios aprox.`;

  const renderRows = (side: "before" | "after") => {
    const slice = side === "before" ? stops.slice(0, anchorIndex) : stops.slice(anchorIndex + 1);
    return slice.map((stop) => {
      const index = stops.indexOf(stop);
      const distance = Math.abs(index - anchorIndex);
      return (
        <RouteStopRow
          key={`${stop.shipmentId}-${stop.type}-${stop.stopOrder}`}
          stop={stop}
          side={side}
          distance={distance}
          gap={distance === 1 ? ANCHOR_ROW_GAP : ROW_GAP}
          visible={expanded}
          isNext={Boolean(nextStop && stop.stopOrder === nextStop.stopOrder)}
          onPress={() => onSelectStop?.(stop)}
        />
      );
    });
  };

  return (
    <View testID={testID} style={{ flex: 1 }} className="bg-bg">
      {/* Manija y encabezado: se arrastran o se tocan para abrir/cerrar la ruta */}
      <View
        testID="stop-list-header"
        {...(panHandlers ?? {})}
        onLayout={(e) => {
          const h = Math.round(e.nativeEvent.layout.height);
          setHeaderHeight((prev) => (prev === h ? prev : h));
        }}
      >
        <Pressable
          testID="stop-list-toggle-sheet"
          onPress={handleToggle}
          className="px-5 pt-2"
          accessibilityRole="button"
          accessibilityLabel={expanded ? "Cerrar la ruta" : "Ver la ruta completa"}
        >
          <View testID="stop-list-drag-handle" className="items-center">
            <View style={{ width: 36, height: 5, borderRadius: 999, backgroundColor: handleColor }} />
          </View>

          <View style={{ height: 48, marginTop: 14 }}>
            <Animated.View
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, { justifyContent: "center", gap: 4 }, headerCollapsedStyle]}
            >
              <Text
                testID="stop-list-summary-title"
                className="font-sans-semibold text-caption uppercase text-fg-3"
              >
                {headerTitle}
              </Text>
              <Text className="font-sans-medium text-[13px] text-fg-2">{headerSubtitle}</Text>
            </Animated.View>

            <Animated.View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                { flexDirection: "row", alignItems: "center", gap: 12 },
                headerExpandedStyle,
              ]}
            >
              <View className="flex-1 gap-0.5">
                <Text className="font-sans-semibold text-[22px] leading-[26px] tracking-[-0.2px] text-fg">
                  Tu ruta
                </Text>
                <Text className="font-sans-medium text-[13px] text-fg-2">{routeSummary}</Text>
              </View>
              <View className="h-11 w-11 items-center justify-center rounded-lg bg-bg-mute">
                <ChevronDown size={20} color={colors.fg1} />
              </View>
            </Animated.View>
          </View>
        </Pressable>
      </View>

      <ScrollView
        ref={scrollRef}
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: CONTENT_PADDING_TOP,
          paddingBottom: bottomPadding,
        }}
        nestedScrollEnabled
        scrollEnabled={expanded}
        refreshControl={
          onRefresh && expanded ? (
            <RefreshControl
              testID="stop-list-refresh-control"
              refreshing={Boolean(isRefreshing)}
              onRefresh={onRefresh}
              tintColor={colors.fg1}
              colors={[INK_950]}
            />
          ) : undefined
        }
      >
        {/* Aviso de ruta no optimizada (AC6), solo con la ruta abierta */}
        {!optimized && expanded && (
          <View
            testID="unoptimized-route-banner"
            className="mb-5 flex-row items-start gap-2.5 rounded-lg border border-warning-300 bg-warning-100 p-3"
          >
            <AlertCircle size={16} color="#D97706" />
            <View className="flex-1">
              <Text className="font-sans-semibold text-[13px] text-ink-950">
                Orden por defecto (no optimizado)
              </Text>
              <Text className="mt-0.5 font-sans text-[12px] leading-4 text-ink-900">
                {disclaimer ??
                  "El optimizador no estuvo disponible. Se muestran los retiros antes que las entregas según su horario."}
              </Text>
            </View>
          </View>
        )}

        {rowsMounted && renderRows("before")}
        {anchorStop && (
          <View testID="stop-list-anchor" onLayout={handleAnchorLayout}>
            <AnchorStopCard
              stop={anchorStop}
              isNext={anchorIsNext}
              openProgress={openProgress}
              onSelect={() => onSelectStop?.(anchorStop)}
              onPressShipment={onPressShipment}
              onPressAction={onPressAction}
              actionDisabled={isActionDisabled?.(anchorStop) ?? false}
            />
          </View>
        )}
        {rowsMounted && renderRows("after")}
      </ScrollView>
    </View>
  );
}

interface AnchorStopCardProps {
  stop: CarrierRouteStop;
  isNext: boolean;
  openProgress: SharedValue<number>;
  onSelect: () => void;
  onPressShipment?: (shipmentId: string) => void;
  onPressAction?: (stop: CarrierRouteStop) => void;
  actionDisabled: boolean;
}

/**
 * Card ancla. La dirección es el título (lo que busca quien maneja) y el ID del envío queda
 * detrás de "Ver envío". Con la ruta abierta, un fondo con borde lima aparece detrás y
 * sobresale `ANCHOR_CHROME_INSET`; el contenido no se mueve ni cambia de ancho.
 */
function AnchorStopCard({
  stop,
  isNext,
  openProgress,
  onSelect,
  onPressShipment,
  onPressAction,
  actionDisabled,
}: AnchorStopCardProps) {
  const colors = useThemeColors();
  const name = useStopCounterpartName(stop);
  const { verb, name: who } = counterpartLine(stop, name);
  const isPickup = stop.type === "pickup";
  const isLate = stop.outsideTimeWindow;
  const windowText = formatTimeWindow(stop.timeWindowStart, stop.timeWindowEnd);

  const chromeStyle = useAnimatedStyle(() => ({
    opacity: openProgress.value,
    transform: [{ scale: interpolate(openProgress.value, [0, 1], [0.97, 1]) }],
  }));

  const actionLabel = actionDisabled
    ? isPickup
      ? "Retiro no disponible"
      : "Entrega próximamente"
    : isPickup
      ? "Retirar paquete"
      : "Entregar paquete";

  return (
    <View style={{ gap: 14 }}>
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: "absolute",
            top: -ANCHOR_CHROME_INSET,
            bottom: -ANCHOR_CHROME_INSET,
            left: -ANCHOR_CHROME_INSET,
            right: -ANCHOR_CHROME_INSET,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: "rgba(198, 242, 74, 0.35)",
            backgroundColor: colors.bgSub,
          },
          chromeStyle,
        ]}
      />

      <Pressable
        testID={`stop-row-${stop.stopOrder}`}
        accessibilityState={{ selected: true }}
        accessibilityRole="button"
        accessibilityLabel={`Parada ${stop.stopOrder}: ${stopKindLabel(stop)} en ${stop.address ?? "dirección a coordinar"}`}
        onPress={onSelect}
        className="gap-2"
      >
        <View className="flex-row items-center gap-2">
          <View
            testID={`stop-chip-${stop.stopOrder}`}
            className="h-6 items-center justify-center rounded-full px-2.5"
            style={{ backgroundColor: isNext ? LIME : colors.bgMute }}
          >
            <Text
              className="font-sans-semibold text-caption uppercase"
              style={{ color: isNext ? INK_950 : colors.fg1 }}
            >
              {stopKindLabel(stop)}
            </Text>
          </View>
          {isLate ? (
            <Text
              testID={`stop-late-badge-${stop.stopOrder}`}
              className="font-sans-semibold text-caption uppercase"
              style={{ color: DANGER }}
            >
              Fuera de ventana
            </Text>
          ) : (
            <Text className="font-sans-semibold text-caption uppercase text-fg-2">
              {isNext ? "Próxima" : `Parada ${stop.stopOrder}`}
            </Text>
          )}
          <View className="flex-1" />
          <Text
            testID={`stop-eta-${stop.stopOrder}`}
            className="font-sans-medium text-[13px]"
            style={{ color: isLate ? DANGER : colors.fg1 }}
          >
            {formatEstimatedArrival(stop)}
          </Text>
        </View>

        <Text
          numberOfLines={2}
          className="font-sans-semibold text-[22px] leading-[26px] tracking-[-0.2px] text-fg"
        >
          {stop.address ?? "Dirección a coordinar"}
        </Text>

        <View className="flex-row items-baseline gap-1.5">
          <Text className="font-sans text-[15px] text-fg-3">{verb}</Text>
          {who && (
            <Text numberOfLines={1} className="flex-shrink font-sans-medium text-[15px] text-fg">
              {who}
            </Text>
          )}
        </View>
        {windowText && (
          <Text className="font-sans text-[13px] text-fg-3">Ventana {windowText}</Text>
        )}
      </Pressable>

      <View className="gap-3">
        <View className="flex-row gap-3">
          {onPressShipment && (
            <Pressable
              testID={`stop-shipment-link-${stop.stopOrder}`}
              onPress={(e) => {
                e.stopPropagation?.();
                onPressShipment(stop.shipmentId);
              }}
              className="h-12 flex-1 flex-row items-center justify-center gap-2 rounded-lg border border-border bg-bg-mute active:opacity-80"
              accessibilityRole="button"
              accessibilityLabel={`Ver detalle del envío ${stop.shipmentId}`}
            >
              <Package size={20} color={colors.fg1} strokeWidth={1.75} />
              <Text className="font-sans-medium text-[16px] text-fg">Ver envío</Text>
            </Pressable>
          )}
          <NavigateButton
            className="flex-1"
            target={{ lat: stop.lat, lng: stop.lng }}
            testID={`stop-navigate-btn-${stop.stopOrder}`}
          />
        </View>

        {/* Acción principal (Retirar/Entregar): solo para la próxima parada */}
        {isNext && (
          <Pressable
            testID={`stop-action-btn-${stop.stopOrder}`}
            disabled={actionDisabled}
            onPress={(e) => {
              e.stopPropagation?.();
              if (onPressAction) {
                onPressAction(stop);
              } else if (onPressShipment) {
                onPressShipment(stop.shipmentId);
              }
            }}
            className={`h-14 w-full items-center justify-center rounded-lg ${
              actionDisabled ? "bg-bg-mute" : "bg-lime-500 active:bg-lime-400"
            }`}
            accessibilityRole="button"
            accessibilityState={{ disabled: actionDisabled }}
            accessibilityLabel={actionLabel}
          >
            <Text
              className={`font-sans-semibold text-[17px] tracking-[-0.2px] ${
                actionDisabled ? "text-fg-3" : "text-ink-950"
              }`}
            >
              {actionLabel}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

interface RouteStopRowProps {
  stop: CarrierRouteStop;
  side: "before" | "after";
  /** Paradas de distancia a la card ancla: define el escalonado al abrir. */
  distance: number;
  /** Separación hacia la card vecina (más grande junto a la ancla, por su fondo). */
  gap: number;
  visible: boolean;
  isNext: boolean;
  onPress: () => void;
}

/**
 * Fila compacta de una parada que no es la ancla. Entra desde la card ancla (arriba o
 * abajo según su lado) con un leve escalonado por distancia; al cerrar se apaga entera
 * de una, sin escalonado. Mismo ancho que el fondo de la card ancla abierta.
 */
function RouteStopRow({ stop, side, distance, gap, visible, isNext, onPress }: RouteStopRowProps) {
  const colors = useThemeColors();
  const name = useStopCounterpartName(stop);
  const { verb, name: who } = counterpartLine(stop, name);
  const isLate = stop.outsideTimeWindow;
  const offset = side === "before" ? -8 : 8;

  const opacity = useSharedValue(0);
  const translateY = useSharedValue(offset);
  useEffect(() => {
    const delay = distance * ROUTE_SHEET_STAGGER_MS;
    if (visible) {
      opacity.value = withDelay(
        delay + ROUTE_SHEET_FADE_DELAY_MS,
        withTiming(1, { duration: Math.round(ROUTE_SHEET_DURATION_MS * 0.7), easing: EASE }),
      );
      translateY.value = withDelay(
        delay + 40,
        withTiming(0, { duration: ROUTE_SHEET_DURATION_MS, easing: EASE }),
      );
    } else {
      opacity.value = withTiming(0, { duration: ROUTE_SHEET_CLOSE_FADE_MS, easing: EASE });
      translateY.value = withTiming(offset, {
        duration: Math.round(ROUTE_SHEET_DURATION_MS * 0.5),
        easing: EASE,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const rowStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  const state = isLate ? "Fuera de ventana" : isNext ? "Próxima" : "Pendiente";
  const chipBg = isLate ? DANGER : isNext ? LIME : colors.bgMute;
  const chipFg = isLate ? "#FFFFFF" : isNext ? INK_950 : colors.fg1;

  return (
    <Animated.View
      style={[
        { marginHorizontal: -ANCHOR_CHROME_INSET },
        side === "before" ? { paddingBottom: gap } : { paddingTop: gap },
        rowStyle,
      ]}
    >
      <Pressable
        testID={`stop-row-${stop.stopOrder}`}
        accessibilityState={{ selected: false }}
        accessibilityRole="button"
        accessibilityLabel={`Parada ${stop.stopOrder}: ${stopKindLabel(stop)} en ${stop.address ?? "dirección a coordinar"}`}
        onPress={onPress}
        className="min-h-[72px] flex-row items-center gap-3 rounded-xl border border-border bg-bg-sub px-3.5 py-3 active:opacity-80"
      >
        {/* Mismo código de forma que los marcadores del mapa: cuadrado retiro, círculo entrega */}
        <View
          testID={`stop-chip-${stop.stopOrder}`}
          className="h-8 w-8 items-center justify-center"
          style={{ backgroundColor: chipBg, borderRadius: stop.type === "pickup" ? 8 : 999 }}
        >
          <Text className="font-sans-semibold text-[14px]" style={{ color: chipFg }}>
            {stop.stopOrder}
          </Text>
        </View>

        <View className="min-w-0 flex-1 gap-0.5">
          <Text
            testID={isLate ? `stop-late-badge-${stop.stopOrder}` : undefined}
            className="font-sans-semibold text-caption uppercase"
            style={{ color: isLate ? DANGER : colors.fg3 }}
          >
            {stopKindLabel(stop)} · {state}
          </Text>
          <Text numberOfLines={1} className="font-sans-medium text-[16px] text-fg">
            {stop.address ?? "Dirección a coordinar"}
          </Text>
          <Text numberOfLines={1} className="font-sans text-[13px] text-fg-3">
            {who ? `${verb} ${who}` : verb}
          </Text>
        </View>

        <Text
          testID={`stop-eta-${stop.stopOrder}`}
          className="font-sans-medium text-[13px]"
          style={{ color: isLate ? DANGER : colors.fg2 }}
        >
          {formatEtaShort(stop)}
        </Text>
      </Pressable>
    </Animated.View>
  );
}
