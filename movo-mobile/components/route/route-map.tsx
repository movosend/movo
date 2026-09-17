import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, type LatLng } from "react-native-maps";
import { useColorScheme } from "nativewind";
import { Crosshair, X, ZoomOut } from "lucide-react-native";
import type { CarrierRouteStop } from "@movo/shared/dist/types/routing";
import {
  movoMapStyleDark,
  movoMapStyleLight,
} from "../../src/constants/map-style";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

interface RouteMapProps {
  carrierLocation: { lat: number; lng: number } | null;
  originLocation?: { lat: number; lng: number } | null;
  stops: CarrierRouteStop[];
  selectedStopOrder?: number | null;
  activeStopOrder?: number | null;
  onSelectStop?: (stop: CarrierRouteStop) => void;
  polylineCoordinates?: LatLng[];
  onResetFocus?: () => void;
  focusTrigger?: number;
  topOffset?: number;
  showControls?: boolean;
  testID?: string;
}

const EDGE_PADDING = { top: 40, right: 40, bottom: 40, left: 40 };

/**
 * Mapa interactivo multi-parada del transportista (MOVO-207).
 *
 * AC2: Muestra todas las paradas ordenadas según el algoritmo VRPTW, con numeración visible (1, 2, ... N).
 * AC3: Diferenciación visual de retiros vs entregas:
 *      - Retiro (`pickup`): marcador circular (código Movo: punto redondo).
 *      - Entrega (`delivery`): marcador cuadrado redondeado.
 * AC5: Si una parada tiene `outsideTimeWindow: true`, se resalta con color de advertencia (#E5484D).
 */
export function RouteMap({
  carrierLocation,
  originLocation,
  stops,
  selectedStopOrder,
  activeStopOrder,
  onSelectStop,
  polylineCoordinates,
  onResetFocus,
  focusTrigger,
  topOffset,
  showControls = true,
  testID = "carrier-route-map",
}: RouteMapProps) {
  const mapRef = useRef<MapView>(null);
  const isMapReady = useRef(false);
  // Estado complementario: si el mapa está enfocado en una parada/transportista (muestra "Ver ruta completa") o en vista general (muestra "Centrar")
  const [isFocused, setIsFocused] = useState<boolean>(() => {
    return selectedStopOrder != null && selectedStopOrder > 1;
  });
  const [activeTooltip, setActiveTooltip] = useState<"origin" | "courier" | null>(null);
  const tooltipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tracksViewChanges, setTracksViewChanges] = useState(true);
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = useThemeColors();

  // Permite que iOS Google Maps dibuje los subviews con dimensiones reales y luego congele el rastreo
  useEffect(() => {
    setTracksViewChanges(true);
    const timer = setTimeout(() => {
      setTracksViewChanges(false);
    }, 600);
    return () => clearTimeout(timer);
  }, [selectedStopOrder, activeStopOrder]);

  const handlePinPress = (type: "origin" | "courier") => {
    setActiveTooltip((prev) => (prev === type ? null : type));
    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current);
    }
    tooltipTimeoutRef.current = setTimeout(() => {
      setActiveTooltip(null);
    }, 4500);
  };

  useEffect(() => {
    return () => {
      if (tooltipTimeoutRef.current) {
        clearTimeout(tooltipTimeoutRef.current);
      }
    };
  }, []);

  // Coordenadas de referencia: origen declarado + posición actual + paradas
  const routePoints: LatLng[] = useMemo(() => {
    const points: LatLng[] = [];
    if (originLocation) {
      points.push({
        latitude: originLocation.lat,
        longitude: originLocation.lng,
      });
    }
    if (carrierLocation) {
      points.push({
        latitude: carrierLocation.lat,
        longitude: carrierLocation.lng,
      });
    }
    for (const s of stops) {
      points.push({
        latitude: s.lat,
        longitude: s.lng,
      });
    }
    return points;
  }, [originLocation, carrierLocation, stops]);

  // Coordenadas para dibujar el trazado: polilínea real de calle/ruta si está disponible, o conexión entre paradas
  const coordinatesToDraw: LatLng[] = useMemo(() => {
    if (polylineCoordinates && polylineCoordinates.length > 1) {
      return polylineCoordinates;
    }
    return routePoints;
  }, [polylineCoordinates, routePoints]);

  // Animación suave de cámara (1000ms) a una parada para evitar saltos bruscos
  const animateToStop = (stop: CarrierRouteStop, duration = 1000) => {
    setIsFocused(true);
    if (!isMapReady.current) return;
    mapRef.current?.animateToRegion(
      {
        latitude: stop.lat,
        longitude: stop.lng,
        latitudeDelta: 0.025,
        longitudeDelta: 0.025,
      },
      duration
    );
  };

  // Animación suave para centrar en la ubicación del transportista
  const animateToCourier = (duration = 1000) => {
    if (!carrierLocation || !isMapReady.current) return;
    setIsFocused(true);
    mapRef.current?.animateToRegion(
      {
        latitude: carrierLocation.lat,
        longitude: carrierLocation.lng,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      },
      duration
    );
  };

  // Al presionar un marcador en el mapa
  const handleMarkerPress = (stop: CarrierRouteStop) => {
    setActiveTooltip(null);
    // Si activeStopOrder está definido y la parada tocada es futura, respetar la regla de Claude Design (aviso sin salto)
    if (activeStopOrder != null && stop.stopOrder !== activeStopOrder) {
      onSelectStop?.(stop);
      return;
    }
    setIsFocused(true);
    animateToStop(stop, 1000);
    onSelectStop?.(stop);
  };

  // Al seleccionar una parada a partir de la interacción explícita del usuario
  useEffect(() => {
    if (!isMapReady.current || !focusTrigger || selectedStopOrder == null) {
      return;
    }
    const stop = stops.find((s) => s.stopOrder === selectedStopOrder);
    if (stop) {
      setIsFocused(true);
      animateToStop(stop, 1000);
    }
  }, [focusTrigger]);

  // Región inicial centrada en el bounding box real del recorrido para evitar saltos globales
  const initialRegion = useMemo(() => {
    if (routePoints.length === 0) {
      return {
        latitude: -31.4167,
        longitude: -64.1833,
        latitudeDelta: 0.1,
        longitudeDelta: 0.1,
      };
    }
    let minLat = routePoints[0].latitude;
    let maxLat = routePoints[0].latitude;
    let minLng = routePoints[0].longitude;
    let maxLng = routePoints[0].longitude;
    for (const p of routePoints) {
      if (p.latitude < minLat) minLat = p.latitude;
      if (p.latitude > maxLat) maxLat = p.latitude;
      if (p.longitude < minLng) minLng = p.longitude;
      if (p.longitude > maxLng) maxLng = p.longitude;
    }
    const centerLat = (minLat + maxLat) / 2;
    const centerLng = (minLng + maxLng) / 2;
    const latDelta = Math.max((maxLat - minLat) * 1.4, 0.06);
    const lngDelta = Math.max((maxLng - minLng) * 1.4, 0.06);
    return {
      latitude: centerLat,
      longitude: centerLng,
      latitudeDelta: latDelta,
      longitudeDelta: lngDelta,
    };
  }, [routePoints]);

  return (
    <View testID={testID} className="flex-1 relative">
      <MapView
        ref={mapRef}
        testID="route-mapview"
        provider={PROVIDER_GOOGLE}
        customMapStyle={isDark ? movoMapStyleDark : movoMapStyleLight}
        initialRegion={initialRegion}
        style={{ width: "100%", height: "100%" }}
        showsUserLocation={false}
        showsCompass={false}
        showsScale={false}
        onMapReady={() => {
          isMapReady.current = true;
        }}
        onPress={() => setActiveTooltip(null)}
      >
        {/* Trazado de ruta conectando las paradas */}
        {coordinatesToDraw.length > 1 && (
          <>
            {/* Trazo inferior de contraste */}
            <Polyline
              coordinates={coordinatesToDraw}
              strokeColor={isDark ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.9)"}
              strokeWidth={6}
              lineCap="round"
              lineJoin="round"
            />
            {/* Trazo superior principal (ink) */}
            <Polyline
              coordinates={coordinatesToDraw}
              strokeColor={isDark ? "#FFFFFF" : "#0A0A0B"}
              strokeWidth={3.5}
              lineCap="round"
              lineJoin="round"
            />
          </>
        )}

        {/* Marcador del punto de partida / origen del viaje (Claude Design originPin) */}
        {originLocation && (
          <Marker
            testID="route-map-origin-marker"
            coordinate={{
              latitude: originLocation.lat,
              longitude: originLocation.lng,
            }}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={tracksViewChanges}
            onPress={() => handlePinPress("origin")}
          >
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: 999,
                backgroundColor: "#FFFFFF",
                borderColor: "#0A0A0B",
                borderWidth: 2.5,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <View
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 999,
                  backgroundColor: "#0A0A0B",
                }}
              />
            </View>
          </Marker>
        )}

        {/* Marcador de la posición actual del transportista (Claude Design courierDot) */}
        {carrierLocation && (
          <Marker
            testID="carrier-current-location-marker"
            coordinate={{
              latitude: carrierLocation.lat,
              longitude: carrierLocation.lng,
            }}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={tracksViewChanges}
            onPress={() => handlePinPress("courier")}
          >
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: 999,
                backgroundColor: "#C6F24A",
                borderColor: "#0A0A0B",
                borderWidth: 2.5,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <View
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  backgroundColor: "#0A0A0B",
                }}
              />
            </View>
          </Marker>
        )}

        {/* Marcadores de paradas ordenadas (círculos limpios sin artefactos de fondo gris ni sombras CALayer) */}
        {stops.map((stop) => {
          const isSelected = selectedStopOrder === stop.stopOrder;
          const isPickup = stop.type === "pickup";
          const isLate = stop.outsideTimeWindow;

          // Claude Design y solicitud del usuario:
          // Retiro: Círculo fondo #0A0A0B (negro), borde #C6F24A (verde lima), texto blanco
          // Entrega: Círculo fondo #C6F24A (verde lima), borde #FFFFFF (blanco), texto negro
          // Tarde: Círculo fondo #E5484D (rojo), borde #FFFFFF (blanco), texto blanco
          let pinBg = isPickup ? "#0A0A0B" : "#C6F24A";
          let pinBorderColor = isPickup ? "#C6F24A" : "#FFFFFF";
          let pinTextColor = isPickup ? "#FFFFFF" : "#0A0A0B";
          if (isLate) {
            pinBg = "#E5484D";
            pinBorderColor = "#FFFFFF";
            pinTextColor = "#FFFFFF";
          }

          const pinSize = isSelected ? 34 : 28;

          return (
            <Marker
              key={`${stop.shipmentId}-${stop.type}-${stop.stopOrder}`}
              testID={`route-map-stop-${stop.stopOrder}`}
              coordinate={{ latitude: stop.lat, longitude: stop.lng }}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={tracksViewChanges}
              onPress={() => handleMarkerPress(stop)}
            >
              <View
                style={{
                  width: pinSize,
                  height: pinSize,
                  borderRadius: 999,
                  backgroundColor: pinBg,
                  borderColor: pinBorderColor,
                  borderWidth: 2.5,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text
                  style={{
                    color: pinTextColor,
                    fontSize: isSelected ? 13 : 11.5,
                  }}
                  className="font-sans-bold"
                >
                  {stop.stopOrder}
                </Text>
              </View>
            </Marker>
          );
        })}
      </MapView>

      {/* Tooltip flotante estilizado para origen o posición actual (reemplaza Callout nativo) */}
      {activeTooltip && (
        <View
          testID={`route-map-tooltip-${activeTooltip}`}
          className="absolute left-3 flex-col rounded-xl border p-3"
          style={{
            top: topOffset ?? 14,
            backgroundColor: isDark ? "rgba(17, 17, 19, 0.95)" : "rgba(255, 255, 255, 0.95)",
            borderColor: colors.border,
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.18,
            shadowRadius: 8,
            elevation: 6,
            maxWidth: 240,
            zIndex: 30,
          }}
        >
          <View className="flex-row items-center justify-between gap-3">
            <View className="flex-row items-center gap-2">
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: activeTooltip === "courier" ? "#C6F24A" : isDark ? "#FFFFFF" : "#0A0A0B",
                }}
              />
              <Text className="font-sans-semibold text-[12.5px] text-fg">
                {activeTooltip === "courier" ? "Tu ubicación actual" : "Origen del viaje"}
              </Text>
            </View>
            <Pressable
              onPress={() => setActiveTooltip(null)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Cerrar tooltip"
            >
              <X size={13} color={colors.fg2} />
            </Pressable>
          </View>
          <Text className="mt-1 font-sans text-[11px] text-fg-2">
            {activeTooltip === "courier"
              ? "En camino a la próxima parada"
              : "Punto de partida declarado"}
          </Text>
        </View>
      )}

      {/* Controles flotantes sobre el mapa: botones complementarios (Centrar <-> Ver ruta completa) */}
      {showControls && (
        <View
          style={{
            position: "absolute",
            right: 16,
            top: topOffset ?? 16,
            zIndex: 20,
          }}
        >
          {isFocused ? (
            <Pressable
              testID="route-map-reset-zoom"
              onPress={() => {
                setIsFocused(false);
                setActiveTooltip(null);
                if (initialRegion) {
                  mapRef.current?.animateToRegion(initialRegion, 1000);
                }
                onResetFocus?.();
              }}
              className="h-9 flex-row items-center gap-1.5 rounded-full border px-3.5 shadow-sm"
              style={{
                backgroundColor: isDark ? "rgba(17, 17, 19, 0.94)" : "rgba(255, 255, 255, 0.94)",
                borderColor: isDark ? "rgba(255, 255, 255, 0.12)" : "rgba(10, 10, 11, 0.10)",
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.12,
                shadowRadius: 4,
                elevation: 4,
              }}
              accessibilityRole="button"
              accessibilityLabel="Ver recorrido completo"
            >
              <ZoomOut size={14} color={colors.fg1} />
              <Text className="font-sans-medium text-[12px] text-fg">Ver ruta completa</Text>
            </Pressable>
          ) : (
            <Pressable
              testID="route-map-recenter"
              onPress={() => {
                setIsFocused(true);
                if (carrierLocation) {
                  animateToCourier(1000);
                } else if (stops.length > 0) {
                  animateToStop(stops[0], 1000);
                }
              }}
              className="h-9 flex-row items-center gap-1.5 rounded-full border px-3.5 shadow-sm"
              style={{
                backgroundColor: isDark ? "rgba(17, 17, 19, 0.94)" : "rgba(255, 255, 255, 0.94)",
                borderColor: isDark ? "rgba(255, 255, 255, 0.12)" : "rgba(10, 10, 11, 0.10)",
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.12,
                shadowRadius: 4,
                elevation: 4,
              }}
              accessibilityRole="button"
              accessibilityLabel="Centrar en mi ubicación"
            >
              <Crosshair size={14} color={colors.fg1} />
              <Text className="font-sans-medium text-[12px] text-fg">Centrar</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}
