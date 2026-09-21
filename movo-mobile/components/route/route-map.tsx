import React, { useEffect, useMemo, useRef, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, type LatLng } from "react-native-maps";
import { useColorScheme } from "nativewind";
import * as Haptics from "expo-haptics";
import { ArrowUpRight, Crosshair, Map, X } from "lucide-react-native";
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
  bottomOffset?: number;
  showControls?: boolean;
  testID?: string;
}


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
  bottomOffset,
  showControls = true,
  testID = "carrier-route-map",
}: RouteMapProps) {
  const mapRef = useRef<MapView>(null);
  const isMapReady = useRef(false);
  // Modo seguimiento continuo del conductor estilo Google Maps:
  // - false (estado natural): muestra el botón "Centrar"
  // - true (centrado siguiendo al transportista): muestra el botón "Ver ruta"
  const [isTrackingCourier, setIsTrackingCourier] = useState<boolean>(false);
  const [activeTooltip, setActiveTooltip] = useState<"origin" | "courier" | null>(null);
  const tooltipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mapsToast, setMapsToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const mapsToastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  }, [selectedStopOrder, activeStopOrder, stops]);

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
      if (mapsToastTimeoutRef.current) {
        clearTimeout(mapsToastTimeoutRef.current);
      }
    };
  }, []);

  // Interactividad para "Abrir en Maps": llamada directa con manejo de éxito y error
  const handleOpenExternalMaps = () => {
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch { }

    const targetStop =
      (selectedStopOrder != null ? stops.find((s) => s.stopOrder === selectedStopOrder) : null) ??
      stops.find((s) => s.stopOrder === (activeStopOrder ?? 1)) ??
      stops[0];

    const destination = targetStop
      ? `${targetStop.lat},${targetStop.lng}`
      : "";

    const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
      destination
    )}&travelmode=driving`;

    Linking.openURL(mapsUrl)
      .then(() => {
        setMapsToast({
          type: "success",
          message: "Iniciando navegación con Google Maps...",
        });
        if (mapsToastTimeoutRef.current) {
          clearTimeout(mapsToastTimeoutRef.current);
        }
        mapsToastTimeoutRef.current = setTimeout(() => {
          setMapsToast(null);
        }, 2400);
      })
      .catch((err) => {
        console.warn("[Movo Navigation] No se pudo abrir la navegación externa:", err);
        setMapsToast({
          type: "error",
          message: "No se pudo abrir la navegación externa.",
        });
        if (mapsToastTimeoutRef.current) {
          clearTimeout(mapsToastTimeoutRef.current);
        }
        mapsToastTimeoutRef.current = setTimeout(() => {
          setMapsToast(null);
        }, 3000);
      });
  };

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

  // Calcula el desplazamiento vertical de la cámara según la altura del bottom sheet (AC4 / Finding 5)
  const getLatitudeOffset = (latDelta: number) => {
    const effectiveBottom = bottomOffset ?? 260;
    return (latDelta * effectiveBottom) / 1600;
  };

  // Animación suave de cámara (1000ms) a una parada para evitar saltos bruscos
  const animateToStop = (stop: CarrierRouteStop, duration = 1000) => {
    if (!isMapReady.current) return;
    const latDelta = 0.022;
    const lngDelta = 0.022;
    mapRef.current?.animateToRegion(
      {
        latitude: stop.lat - getLatitudeOffset(latDelta),
        longitude: stop.lng,
        latitudeDelta: latDelta,
        longitudeDelta: lngDelta,
      },
      duration
    );
  };

  // Animación suave para centrar en la ubicación del transportista
  const animateToCourier = (duration = 1000) => {
    if (!carrierLocation || !isMapReady.current) return;
    const latDelta = 0.02;
    const lngDelta = 0.02;
    mapRef.current?.animateToRegion(
      {
        latitude: carrierLocation.lat - getLatitudeOffset(latDelta),
        longitude: carrierLocation.lng,
        latitudeDelta: latDelta,
        longitudeDelta: lngDelta,
      },
      duration
    );
  };

  // Seguimiento continuo de la ubicación del transportista (estilo Google Maps)
  useEffect(() => {
    if (isTrackingCourier && carrierLocation && isMapReady.current) {
      const latDelta = 0.02;
      const lngDelta = 0.02;
      mapRef.current?.animateToRegion(
        {
          latitude: carrierLocation.lat - getLatitudeOffset(latDelta),
          longitude: carrierLocation.lng,
          latitudeDelta: latDelta,
          longitudeDelta: lngDelta,
        },
        800
      );
    }
  }, [carrierLocation?.lat, carrierLocation?.lng, isTrackingCourier, bottomOffset]);

  // Al presionar un marcador en el mapa, desactiva el seguimiento continuo del chofer
  const handleMarkerPress = (stop: CarrierRouteStop) => {
    setActiveTooltip(null);
    setIsTrackingCourier(false);
    // Si activeStopOrder está definido y la parada tocada es futura, respetar la regla de Claude Design (aviso sin salto)
    if (activeStopOrder != null && stop.stopOrder !== activeStopOrder) {
      onSelectStop?.(stop);
      return;
    }
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
      setIsTrackingCourier(false);
      animateToStop(stop, 1000);
    }
  }, [focusTrigger]);

  const handleCenterPress = () => {
    setIsTrackingCourier(true);
    setActiveTooltip(null);
    if (carrierLocation) {
      animateToCourier(1000);
    } else if (stops.length > 0) {
      animateToStop(stops[0], 1000);
    }
  };

  const handleOverviewPress = () => {
    setIsTrackingCourier(false);
    setActiveTooltip(null);
    if (initialRegion) {
      mapRef.current?.animateToRegion(initialRegion, 1000);
    }
    onResetFocus?.();
  };

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
        onPanDrag={() => {
          setIsTrackingCourier(false);
          setActiveTooltip(null);
        }}
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
                borderWidth: 3,
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

        {/* Marcador de la posición actual del transportista (Claude Design courierDot: punto verde lima con borde blanco) */}
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
                width: 20,
                height: 20,
                borderRadius: 999,
                backgroundColor: "#C6F24A",
                borderColor: "#FFFFFF",
                borderWidth: 3,
                alignItems: "center",
                justifyContent: "center",
              }}
            />
          </Marker>
        )}

        {/* Marcadores de paradas ordenadas: Cuadrados para retiros y Círculos para entregas (Claude Design mapPinStyle) */}
        {stops.map((stop) => {
          const isSelected = selectedStopOrder === stop.stopOrder;
          const isPickup = stop.type === "pickup";
          const isLate = stop.outsideTimeWindow;

          // Claude Design mapPinStyle con highlight cuando está seleccionada (AC4):
          // Todos los nodos de parada tienen fondo #0A0A0B (negro) y número blanco #FFFFFF.
          // Retiro: Cuadrado redondeado (radius 8 / 10 si seleccionada)
          // Entrega: Círculo (radius 999)
          // Borde: 2.5px blanco #FFFFFF por defecto; 3.5px verde lima #C6F24A si está seleccionada
          // Demora (isLate): Fondo #E5484D (rojo alerta)
          let pinBg = "#0A0A0B";
          let pinBorderColor = isSelected ? "#C6F24A" : "#FFFFFF";
          let pinTextColor = "#FFFFFF";
          if (isLate) {
            pinBg = "#E5484D";
            pinBorderColor = isSelected ? "#C6F24A" : "#FFFFFF";
            pinTextColor = "#FFFFFF";
          }

          const pinSize = isSelected ? 34 : 28;
          const pinRadius = isPickup ? (isSelected ? 10 : 8) : 999;
          const pinBorderWidth = isSelected ? 3.5 : 2.5;

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
                  borderRadius: pinRadius,
                  backgroundColor: pinBg,
                  borderColor: pinBorderColor,
                  borderWidth: pinBorderWidth,
                  alignItems: "center",
                  justifyContent: "center",
                  ...(isSelected
                    ? {
                      shadowColor: "#C6F24A",
                      shadowOffset: { width: 0, height: 2 },
                      shadowOpacity: 0.4,
                      shadowRadius: 6,
                      elevation: 5,
                    }
                    : {}),
                }}
              >
                <Text
                  style={{
                    color: pinTextColor,
                    fontSize: isSelected ? 13 : 12,
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

      {/* Toast Feedback de navegación externa (Screen 1 Interactivity) posicionado justo debajo de la isla flotante */}
      {mapsToast && (
        <View
          testID="route-navigation-toast"
          style={{
            position: "absolute",
            top: topOffset ?? 16,
            alignSelf: "center",
            zIndex: 40,
            backgroundColor: isDark ? "rgba(17, 17, 19, 0.94)" : "rgba(255, 255, 255, 0.94)",
            borderColor: isDark ? "rgba(255, 255, 255, 0.12)" : "rgba(10, 10, 11, 0.08)",
            borderWidth: 1,
            borderRadius: 9999,
            paddingHorizontal: 16,
            paddingVertical: 9,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: isDark ? 0.25 : 0.12,
            shadowRadius: 10,
            elevation: 6,
          }}
        >
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: mapsToast.type === "error" ? "#E5484D" : "#C6F24A",
            }}
          />
          <Text
            style={{
              fontSize: 12,
              fontWeight: "600",
              color: isDark ? "#FFFFFF" : "#0A0A0B",
            }}
          >
            {mapsToast.message}
          </Text>
        </View>
      )}

      {/* Control flotante individual alterno sobre el mapa ("Centrar" <-> "Ver ruta") estilo Google Maps */}
      {showControls && (
        <View
          style={{
            position: "absolute",
            right: 14,
            top: topOffset ?? 16,
            zIndex: 20,
          }}
        >
          {isTrackingCourier ? (
            <Pressable
              testID="route-map-reset-zoom"
              onPress={handleOverviewPress}
              accessibilityRole="button"
              accessibilityLabel="Ver ruta completa"
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  paddingHorizontal: 14,
                  paddingVertical: 9,
                  borderRadius: 16,
                  backgroundColor: isDark ? "#18181B" : "#FFFFFF",
                  borderWidth: 1,
                  borderColor: isDark ? "rgba(255, 255, 255, 0.15)" : "#E4E4E7",
                  shadowColor: "#000",
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.12,
                  shadowRadius: 10,
                  elevation: 6,
                }}
              >
                <Map
                  size={15}
                  color={isDark ? "#FFFFFF" : "#0A0A0B"}
                  strokeWidth={2.2}
                />
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: "700",
                    color: isDark ? "#FFFFFF" : "#0A0A0B",
                  }}
                >
                  Ver ruta
                </Text>
              </View>
            </Pressable>
          ) : (
            <Pressable
              testID="route-map-recenter"
              onPress={handleCenterPress}
              accessibilityRole="button"
              accessibilityLabel="Centrar en mi ubicación"
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  paddingHorizontal: 14,
                  paddingVertical: 9,
                  borderRadius: 16,
                  backgroundColor: isDark ? "#18181B" : "#FFFFFF",
                  borderWidth: 1,
                  borderColor: isDark ? "rgba(255, 255, 255, 0.15)" : "#E4E4E7",
                  shadowColor: "#000",
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.12,
                  shadowRadius: 10,
                  elevation: 6,
                }}
              >
                <Crosshair
                  size={15}
                  color={isDark ? "#FFFFFF" : "#0A0A0B"}
                  strokeWidth={2.2}
                />
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: "700",
                    color: isDark ? "#FFFFFF" : "#0A0A0B",
                  }}
                >
                  Centrar
                </Text>
              </View>
            </Pressable>
          )}
        </View>
      )}

      {/* Botón flotante "Abrir en Maps" (Visual Screen 2 + Interactividad Screen 1) */}
      {showControls && stops.length > 0 && (
        <View
          style={{
            position: "absolute",
            right: 14,
            bottom: (bottomOffset ?? 270) + 16,
            zIndex: 25,
          }}
        >
          <Pressable
            testID="route-map-open-maps"
            onPress={handleOpenExternalMaps}
            accessibilityRole="button"
            accessibilityLabel="Abrir en Maps para navegación paso a paso"
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                paddingHorizontal: 14,
                paddingVertical: 10,
                borderRadius: 16,
                backgroundColor: isDark ? "#18181B" : "#FFFFFF",
                borderWidth: 1,
                borderColor: isDark ? "rgba(255, 255, 255, 0.15)" : "#E4E4E7",
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.12,
                shadowRadius: 10,
                elevation: 6,
              }}
            >
              <View
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 8,
                  backgroundColor: "#0A0A0B",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <ArrowUpRight size={14} color="#FFFFFF" strokeWidth={2.5} />
              </View>
              <View style={{ justifyContent: "center" }}>
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: "800",
                    lineHeight: 14,
                    color: isDark ? "#FFFFFF" : "#0A0A0B",
                  }}
                >
                  Abrir en Maps
                </Text>
                <Text
                  style={{
                    fontSize: 9,
                    fontWeight: "500",
                    lineHeight: 12,
                    color: isDark ? "#A1A1AA" : "#71717A",
                  }}
                >
                  GPS paso a paso
                </Text>
              </View>
            </View>
          </Pressable>
        </View>
      )}
    </View>
  );
}
