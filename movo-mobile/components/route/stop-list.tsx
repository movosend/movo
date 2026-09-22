import React, { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  ChevronUp,
} from "lucide-react-native";
import {
  GestureResponderHandlers,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useColorScheme } from "nativewind";
import type { CarrierRoute, CarrierRouteStop } from "@movo/shared/dist/types/routing";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

interface StopListProps {
  route: CarrierRoute;
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

/**
 * Formatea el ETA estimado asegurando que se presente siempre como estimación (AC11: "aprox.").
 */
export function formatEstimatedArrival(stop: CarrierRouteStop): string {
  if (stop.estimatedArrivalAt) {
    try {
      const d = new Date(stop.estimatedArrivalAt);
      if (!isNaN(d.getTime())) {
        const hh = String(d.getHours()).padStart(2, "0");
        const mm = String(d.getMinutes()).padStart(2, "0");
        return `${hh}:${mm} aprox.`;
      }
    } catch {
      // fallback abajo
    }
  }
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
  if (instantStr.includes("T")) {
    const d = new Date(instantStr);
    if (!isNaN(d.getTime())) {
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      return `${hh}:${mm}`;
    }
  }
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
    return `${startFmt} - ${endFmt}`;
  }
  if (startFmt) {
    return `Desde ${startFmt}`;
  }
  if (endFmt) {
    return `Hasta ${endFmt}`;
  }
  return null;
}

/**
 * Lista sincronizada de paradas para la ruta optimizada (MOVO-207) según Claude Design.
 *
 * AC4: Muestra cada parada con su orden, tipo (retiro/entrega), dirección, ventana horaria y ETA.
 * AC5: Si `outsideTimeWindow: true`, se marca explícitamente como fuera de ventana/demora estimada.
 * AC6: Si `route.optimized === false`, muestra aviso discreto de degradación heurística.
 * AC9: Permite navegar al detalle del envío (`/shipments/:id`).
 * AC11: El ETA se presenta con copy "aprox." (estimación geométrica sin tráfico en tiempo real).
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
  testID = "carrier-stop-list",
}: StopListProps) {
  const colors = useThemeColors();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const { stops, totalDistanceKm, totalDurationMinutes, optimized, disclaimer } = route;

  const [internalExpanded, setInternalExpanded] = useState(false);
  const expanded = isExpanded ?? internalExpanded;
  const handleToggle = onToggleExpand ?? (() => setInternalExpanded((prev) => !prev));

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Parada activa que corresponde ejecutar primero según orden estricto de Claude Design
  const activeStop =
    stops.find((s) => s.stopOrder === (activeStopOrder ?? 1)) ?? stops[0];

  const showToast = (msg: string) => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToastMessage(msg);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 3000);
  };

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  const handlePressStop = (stop: CarrierRouteStop) => {
    onSelectStop?.(stop);
  };

  // Se muestran todas las paradas en el scroll; la activa incluye sus CTA y las demás en modo pendiente
  const stopsToDisplay = stops;

  return (
    <View testID={testID} className="flex-1 bg-bg px-4 pb-8 pt-1">
      {/* Header interactivo con toggle de lista completa y soporte de arrastre para bottom sheet */}
      <View {...(panHandlers ?? {})}>
        <Pressable
          testID="stop-list-toggle-sheet"
          onPress={handleToggle}
          className="items-center pb-2.5 pt-0.5"
          accessibilityRole="button"
          accessibilityLabel={
            expanded ? "Ver mapa" : `Ver todas las ${stops.length} paradas`
          }
        >
          {/* Handle superior centrado para arrastrar el sheet ("ese coso") */}
          <View
            testID="stop-list-drag-handle"
            className="w-full items-center pt-1 pb-2.5"
          >
            <View
              style={{
                width: 48,
                height: 5,
                borderRadius: 999,
                backgroundColor: isDark
                  ? "rgba(255, 255, 255, 0.28)"
                  : "rgba(10, 10, 11, 0.20)",
              }}
            />
          </View>

        {/* Barra de cabecera con título dinámico y botón de toggle */}
        <View className="w-full flex-row items-center justify-between border-b border-border pb-3">
          <View>
            <Text
              testID="stop-list-summary-title"
              className="font-sans-semibold text-[15px] text-fg"
            >
              {expanded
                ? `Itinerario · ${stops.length} ${stops.length === 1 ? "parada" : "paradas"}`
                : `Próxima parada · ${activeStop ? `${activeStop.stopOrder} de ${stops.length}` : `${stops.length}`}`}
            </Text>
            <Text className="font-sans text-[12px] text-fg-3">
              {totalDistanceKm > 0 ? `${totalDistanceKm.toFixed(1)} km · ` : ""}
              {totalDurationMinutes > 0
                ? `${formatDuration(totalDurationMinutes)} aprox.`
                : "Tiempo est. variable"}
            </Text>
          </View>

          <View className="flex-row items-center gap-2">
            {optimized ? (
              <View className="hidden sm:flex flex-row items-center gap-1 rounded-full bg-lime-500/15 px-2 py-0.5 border border-lime-500/20">
                <View className="h-1.5 w-1.5 rounded-full bg-lime-500" />
                <Text className="font-sans-medium text-[10.5px] text-lime-600 dark:text-lime-400">
                  Óptima
                </Text>
              </View>
            ) : null}

            <View className="flex-row items-center gap-1 rounded-full border border-border bg-bg-sub px-2.5 py-1.5">
              <Text className="font-sans-medium text-[11.5px] text-fg">
                {expanded ? "Ver mapa" : `Ver todas (${stops.length})`}
              </Text>
              {expanded ? (
                <ChevronDown size={14} color={colors.fg2} />
              ) : (
                <ChevronUp size={14} color={colors.fg2} />
              )}
            </View>
          </View>
        </View>
      </Pressable>
      </View>

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 28 }}
        nestedScrollEnabled
        refreshControl={
          onRefresh ? (
            <RefreshControl
              testID="stop-list-refresh-control"
              refreshing={Boolean(isRefreshing)}
              onRefresh={onRefresh}
              tintColor="#0A0A0B"
              colors={["#0A0A0B"]}
            />
          ) : undefined
        }
      >

      {/* Banner de ruta no optimizada (AC6) */}
      {!optimized && (
        <View
          testID="unoptimized-route-banner"
          className="my-3 flex-row items-start gap-2.5 rounded-[10px] border border-warning-300 bg-warning-100 p-3"
        >
          <AlertCircle size={16} color="#D97706" className="mt-0.5 flex-none" />
          <View className="flex-1">
            <Text className="font-sans-semibold text-[12.5px] text-ink-950">
              Orden por defecto (no optimizado)
            </Text>
            <Text className="mt-0.5 font-sans text-[11.5px] text-ink-900">
              {disclaimer ??
                "El optimizador no estuvo disponible. Se muestran los retiros antes que las entregas según su horario."}
            </Text>
          </View>
        </View>
      )}

      {/* Items de paradas */}
      <View className="mt-3 gap-2.5">
        {stopsToDisplay.map((stop) => {
          // La parada abierta y destacada es la seleccionada actualmente (por defecto la activa/próxima)
          const currentHighlightedOrder = selectedStopOrder ?? activeStop?.stopOrder ?? 1;
          const isHighlighted = stop.stopOrder === currentHighlightedOrder;
          const isNext = Boolean(activeStop && stop.stopOrder === activeStop.stopOrder);
          const isPickup = stop.type === "pickup";
          const actionDisabled = isActionDisabled?.(stop) ?? false;
          const isLate = stop.outsideTimeWindow;
          const windowText = formatTimeWindow(stop.timeWindowStart, stop.timeWindowEnd);
          const etaText = formatEstimatedArrival(stop);

          // Coherencia visual con los nodos del mapa (route-map.tsx):
          // Todos los nodos tienen fondo #0A0A0B (negro), número #FFFFFF (blanco) y borde blanco sencillo.
          // Retiro: Cuadrado redondeado (radius 8)
          // Entrega: Círculo (radius 999)
          // Demora (isLate): Fondo #E5484D (rojo alerta)
          let chipBg = "#0A0A0B";
          let chipBorderColor = "#FFFFFF";
          let chipTextColor = "#FFFFFF";
          if (isLate) {
            chipBg = "#E5484D";
            chipBorderColor = "#FFFFFF";
            chipTextColor = "#FFFFFF";
          }

          const shipmentLabel = stop.shipmentId
            .replace("demo-shipment-", "")
            .replace("ship-", "#");
          const detailText = isPickup
            ? `Retirás paquete · Envío ${shipmentLabel}`
            : `Entregás paquete · Envío ${shipmentLabel}`;

          return (
            <Pressable
              key={`${stop.shipmentId}-${stop.type}-${stop.stopOrder}`}
              testID={`stop-row-${stop.stopOrder}`}
              accessibilityState={{ selected: isHighlighted }}
              onPress={() => handlePressStop(stop)}
              className="rounded-[12px] border p-3.5"
              style={{
                backgroundColor: isHighlighted ? colors.bg : colors.bgSub,
                borderColor: isHighlighted ? colors.fg1 : colors.border,
                borderWidth: isHighlighted ? 1.5 : 1,
                ...(isHighlighted
                  ? {
                    shadowColor: "#000",
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: isDark ? 0.3 : 0.08,
                    shadowRadius: 10,
                    elevation: 3,
                  }
                  : {}),
              }}
            >
              <View className="flex-row items-start gap-3">
                {/* Chip numérico: cuadrado redondeado para retiro, círculo para entrega */}
                <View
                  style={{
                    backgroundColor: chipBg,
                    borderRadius: isPickup ? 8 : 999,
                  }}
                  testID={`stop-chip-${stop.stopOrder}`}
                  className="h-7 w-7 flex-none items-center justify-center"
                >
                  <Text
                    style={{ color: chipTextColor }}
                    className="font-sans-bold text-[12px]"
                  >
                    {stop.stopOrder}
                  </Text>
                </View>

                {/* Contenido de la parada */}
                <View className="flex-1 min-w-0">
                  <View className="flex-row items-center gap-2">
                    <Text
                      className={`font-sans-bold text-[10px] tracking-wider uppercase ${isPickup ? "text-fg" : "text-fg-2"
                        }`}
                    >
                      {isPickup ? "Retiro" : "Entrega"}
                    </Text>

                    {/* Pill de estado: Solo activeStop es 'Próxima', las demás son 'Pendiente' (Claude Design) */}
                    {isLate ? (
                      <View
                        testID={`stop-late-badge-${stop.stopOrder}`}
                        className="rounded-full bg-danger-100 px-2 py-0.5 border border-danger-300"
                      >
                        <Text className="font-sans-semibold text-[9px] tracking-wider uppercase text-danger-700">
                          Fuera de ventana
                        </Text>
                      </View>
                    ) : isNext ? (
                      <View className="rounded-full bg-fg px-2 py-0.5">
                        <Text className="font-sans-semibold text-[9px] tracking-wider uppercase text-bg">
                          Próxima
                        </Text>
                      </View>
                    ) : (
                      <View className="rounded-full bg-bg-mute px-2 py-0.5">
                        <Text className="font-sans-semibold text-[9px] tracking-wider uppercase text-fg-3">
                          Pendiente
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Dirección */}
                  <Text
                    numberOfLines={1}
                    className="mt-1 font-sans-medium text-[13.5px] text-fg"
                  >
                    {stop.address ?? "Dirección a coordinar"}
                  </Text>

                  {/* Subtítulo / Detalle del envío */}
                  <Text
                    numberOfLines={1}
                    className="mt-0.5 font-sans text-[11.5px] text-fg-3"
                  >
                    {detailText}
                  </Text>
                </View>

                {/* Columna derecha: ETA y franja horaria */}
                <View className="flex-none items-end gap-0.5">
                  <Text
                    testID={`stop-eta-${stop.stopOrder}`}
                    className={`font-mono text-[12px] ${isLate ? "text-danger-700 font-sans-bold" : "text-fg font-sans-semibold"
                      }`}
                  >
                    {etaText}
                  </Text>
                  {windowText && (
                    <Text className="font-sans text-[10.5px] text-fg-3">
                      {windowText}
                    </Text>
                  )}
                </View>
              </View>

              {/* Botonera expandida para el envío seleccionado/destacado */}
              {isHighlighted && (
                <View className="mt-3 flex-row items-center gap-2.5 border-t border-border pt-3">
                  {onPressShipment && (
                    <Pressable
                      testID={`stop-shipment-link-${stop.stopOrder}`}
                      onPress={(e) => {
                        e.stopPropagation?.();
                        onPressShipment(stop.shipmentId);
                      }}
                      className={`h-11 rounded-[10px] border border-border bg-bg active:bg-bg-mute flex-row items-center justify-center gap-1.5 ${
                        isNext ? "flex-1" : "w-full"
                      }`}
                      accessibilityRole="button"
                      accessibilityLabel={`Ver detalle del envío ${stop.shipmentId}`}
                    >
                      <Text className="font-sans-medium text-[13.5px] text-fg">Ver envío</Text>
                      <ArrowUpRight size={15} color={colors.fg2} />
                    </Pressable>
                  )}

                  {/* Botón de acción (Retirar/Entregar) solo disponible para la próxima parada activa */}
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
                      className={`flex-1 h-11 rounded-[10px] flex-row items-center justify-center gap-1.5 ${
                        actionDisabled ? "bg-bg-mute" : "bg-lime-500 active:bg-lime-400"
                      }`}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: actionDisabled }}
                      accessibilityLabel={isPickup ? "Retirar paquete" : "Entregar paquete"}
                    >
                      <Text
                        className={`font-sans-semibold text-[13.5px] ${actionDisabled ? "text-fg-3" : "text-ink-950"}`}
                      >
                        {actionDisabled ? "Entrega próximamente" : isPickup ? "Retirar paquete" : "Entregar paquete"}
                      </Text>
                      {!actionDisabled && <ChevronRight size={15} color="#0A0A0B" />}
                    </Pressable>
                  )}
                </View>
              )}
            </Pressable>
          );
        })}
      </View>

      {/* Toast flotante para avisos de parada pendiente (Claude Design hasToast) */}
      {toastMessage && (
        <View
          testID="stop-list-toast"
          className="mt-4 rounded-[10px] bg-ink-950 px-4 py-3 shadow-lg"
          style={{
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.25,
            shadowRadius: 8,
            elevation: 6,
          }}
        >
          <Text className="font-sans-medium text-[13px] leading-5 text-white">
            {toastMessage}
          </Text>
        </View>
      )}
      </ScrollView>
    </View>
  );
}
