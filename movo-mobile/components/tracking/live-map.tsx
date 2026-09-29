import React, { useEffect, useRef, useState, useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE, type LatLng } from "react-native-maps";
import { useColorScheme } from "nativewind";
import * as Haptics from "expo-haptics";
import { Crosshair, Map, MapPin, Truck } from "lucide-react-native";
import {
  movoMapStyleDark,
  movoMapStyleLight,
} from "../../src/constants/map-style";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import type { LiveCarrierPosition, TrackingStatus } from "../../src/hooks/use-live-position";

export interface LiveMapProps {
  carrierPosition?: LiveCarrierPosition | null;
  destinationLocation?: { lat: number; lng: number } | null;
  carrierName?: string;
  trackingStatus?: TrackingStatus;
  lastUpdateText?: string;
  topOffset?: number;
  bottomOffset?: number;
  showControls?: boolean;
  testID?: string;
}

/**
 * Mapa interactivo de seguimiento en vivo para emisor y receptor (MOVO-204).
 *
 * Cumplimiento estricto de ADR-023:
 * - NO dibuja trazas históricas ni polilíneas del recorrido del transportista.
 * - Solo renderiza la posición actual del conductor y el pin del destino final.
 * - Muestra la pildora de telemetría de conexión y controles de recentrado táctico.
 */
export function LiveMap({
  carrierPosition,
  destinationLocation,
  carrierName = "Transportista",
  trackingStatus = "connecting",
  lastUpdateText,
  topOffset = 56,
  bottomOffset = 260,
  showControls = true,
  testID = "live-tracking-map",
}: LiveMapProps) {
  const mapRef = useRef<MapView>(null);
  const markerRef = useRef<any>(null);
  const isMapReady = useRef(false);
  const hasFittedRef = useRef(false);
  const [isFollowingCarrier, setIsFollowingCarrier] = useState(false);
  const [tracksViewChanges, setTracksViewChanges] = useState(true);

  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = useThemeColors();

  // Permite que los subviews nativos se rendericen y luego congela el ciclo de rastreo para alto rendimiento
  useEffect(() => {
    setTracksViewChanges(true);
    const timer = setTimeout(() => {
      setTracksViewChanges(false);
    }, 600);
    return () => clearTimeout(timer);
  }, [carrierPosition, destinationLocation]);

  // Desplazamiento vertical para que el marcador quede en el centro del área visible sobre el bottom sheet.
  // 1600 pts es el factor de escala empírico (aprox. 2x viewport height) que proyecta los píxeles de oclusión del bottom sheet a latDelta.
  const getLatitudeOffset = useCallback(
    (latDelta: number) => {
      const effectiveBottom = bottomOffset ?? 290;
      return (latDelta * effectiveBottom) / 1600;
    },
    [bottomOffset]
  );

  // Centrar cámara en el transportista con animación suave y offset
  // (carrierPosition ya viene retenido por useLivePosition como single source of truth)
  const centerOnCarrier = useCallback(
    (duration = 600) => {
      if (!carrierPosition || !mapRef.current) return;

      const latDelta = 0.016;
      const lngDelta = 0.016;
      const offset = getLatitudeOffset(latDelta);

      mapRef.current.animateToRegion(
        {
          latitude: carrierPosition.lat - offset,
          longitude: carrierPosition.lng,
          latitudeDelta: latDelta,
          longitudeDelta: lngDelta,
        },
        duration
      );
    },
    [carrierPosition, getLatitudeOffset]
  );

  // Encuadrar el mapa para mostrar conductor y destino con márgenes
  const fitCarrierAndDestination = useCallback(
    (animated = true) => {
      if (!mapRef.current || !isMapReady.current) return;

      const coordinates: LatLng[] = [];
      if (carrierPosition) {
        coordinates.push({
          latitude: carrierPosition.lat,
          longitude: carrierPosition.lng,
        });
      }
      if (destinationLocation) {
        coordinates.push({
          latitude: destinationLocation.lat,
          longitude: destinationLocation.lng,
        });
      }

      if (coordinates.length === 0) return;

      if (coordinates.length === 1) {
        const latDelta = 0.016;
        const lngDelta = 0.016;
        const offset = getLatitudeOffset(latDelta);
        mapRef.current.animateToRegion(
          {
            latitude: coordinates[0].latitude - offset,
            longitude: coordinates[0].longitude,
            latitudeDelta: latDelta,
            longitudeDelta: lngDelta,
          },
          animated ? 500 : 0
        );
        return;
      }

      mapRef.current.fitToCoordinates(coordinates, {
        edgePadding: {
          top: topOffset + 40,
          right: 48,
          bottom: bottomOffset + 40,
          left: 48,
        },
        animated,
      });
    },
    [carrierPosition, destinationLocation, topOffset, bottomOffset, getLatitudeOffset]
  );

  // Al estar listo el mapa, ajustamos el encuadre inicial
  const handleMapReady = useCallback(() => {
    isMapReady.current = true;
    if (!hasFittedRef.current && (carrierPosition || destinationLocation)) {
      hasFittedRef.current = true;
      fitCarrierAndDestination(false);
    }
  }, [carrierPosition, destinationLocation, fitCarrierAndDestination]);

  // Si los datos llegan tarde por HTTP tras montar, encuadrar la primera vez que haya coordenadas
  useEffect(() => {
    if (isMapReady.current && !hasFittedRef.current && (carrierPosition || destinationLocation)) {
      hasFittedRef.current = true;
      fitCarrierAndDestination(true);
    }
  }, [carrierPosition, destinationLocation, fitCarrierAndDestination]);

  // Si cambia la posición y estamos en modo seguimiento activo, actualizamos la cámara
  useEffect(() => {
    if (isFollowingCarrier && carrierPosition && isMapReady.current) {
      centerOnCarrier(450);
    }
  }, [carrierPosition?.lat, carrierPosition?.lng, isFollowingCarrier, centerOnCarrier]);

  // Animación suave del marcador entre coordenadas recibidas
  useEffect(() => {
    if (carrierPosition && markerRef.current?.animateMarkerToCoordinate) {
      markerRef.current.animateMarkerToCoordinate(
        {
          latitude: carrierPosition.lat,
          longitude: carrierPosition.lng,
        },
        500
      );
    }
  }, [carrierPosition?.lat, carrierPosition?.lng]);

  // Botón centrar en el conductor: siempre centra en la última ubicación conocida
  const handleCenterCarrier = () => {
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {}
    setIsFollowingCarrier(true);
    centerOnCarrier(600);
  };

  // Botón ver mapa completo (conductor + destino)
  const handleOverview = () => {
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {}
    setIsFollowingCarrier(false);
    fitCarrierAndDestination(true);
  };

  // Coordenada inicial por defecto (Córdoba, Argentina) si no hay posición todavía
  const initialRegion = {
    latitude: carrierPosition?.lat ?? destinationLocation?.lat ?? -31.4201,
    longitude: carrierPosition?.lng ?? destinationLocation?.lng ?? -64.1888,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
  };

  // Colores y textos para la píldora de telemetría de conexión
  const statusMeta = {
    live: {
      dotBg: "#C6F24A",
      text: "En vivo",
      sub: lastUpdateText ? lastUpdateText : "Actualizado",
    },
    no_position: {
      dotBg: "#71717A",
      text: "Sin ubicación",
      sub: "Disponible al iniciar el viaje",
    },
    reconnecting: {
      dotBg: "#F59E0B",
      text: "Reconectando",
      sub: "Reintentando...",
    },
    stale: {
      dotBg: "#F59E0B",
      text: "Pausado",
      sub: lastUpdateText ? `Última ubicación: ${lastUpdateText}` : "Sin señal",
    },
    closed: {
      dotBg: "#71717A",
      text: "Finalizado",
      sub: "Entrega completada",
    },
    connecting: {
      dotBg: "#3B82F6",
      text: "Conectando",
      sub: "Buscando señal...",
    },
  }[trackingStatus];

  return (
    <View testID={testID} style={[styles.container, { backgroundColor: colors.bg }]}>
      <MapView
        ref={mapRef}
        testID="live-map-view"
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_GOOGLE}
        customMapStyle={isDark ? movoMapStyleDark : movoMapStyleLight}
        initialRegion={initialRegion}
        onMapReady={handleMapReady}
        onPanDrag={() => {
          setIsFollowingCarrier(false);
        }}
        showsCompass={false}
        showsTraffic={false}
        showsBuildings={false}
        showsIndoors={false}
        showsPointsOfInterests={false}
        showsUserLocation={false}
      >
        {/* MARCADOR 1: Destino Final */}
        {destinationLocation && (
          <Marker
            testID="live-map-destination-marker"
            coordinate={{
              latitude: destinationLocation.lat,
              longitude: destinationLocation.lng,
            }}
            anchor={{ x: 0.5, y: 1 }}
            tracksViewChanges={tracksViewChanges}
          >
            <View style={styles.destinationMarkerWrapper}>
              <View
                style={[
                  styles.destinationBadge,
                  {
                    backgroundColor: isDark ? "#18181B" : "#FFFFFF",
                    borderColor: isDark ? "rgba(255,255,255,0.15)" : "#E4E4E7",
                  },
                ]}
              >
                <Text
                  style={[
                    styles.destinationBadgeText,
                    { color: isDark ? "#FFFFFF" : "#0A0A0B" },
                  ]}
                >
                  Destino
                </Text>
              </View>
              <View
                style={[
                  styles.destinationPinCircle,
                  {
                    backgroundColor: isDark ? "#27272A" : "#FFFFFF",
                    shadowColor: "#000",
                  },
                ]}
              >
                <View style={styles.destinationPinInner}>
                  <MapPin size={15} color="#FFFFFF" />
                </View>
              </View>
              <View style={styles.destinationPinPoint} />
            </View>
          </Marker>
        )}

        {/* MARCADOR 2: Transportista en Tiempo Real (ADR-023: Sin traza histórica) */}
        {carrierPosition && (
          <Marker
            ref={markerRef}
            testID="live-map-carrier-marker"
            coordinate={{
              latitude: carrierPosition.lat,
              longitude: carrierPosition.lng,
            }}
            anchor={{ x: 0.5, y: 0.7 }}
            tracksViewChanges={tracksViewChanges}
          >
            <View style={styles.carrierMarkerWrapper}>
              {/* Callout flotante de estado y nombre */}
              <View
                style={[
                  styles.carrierCallout,
                  {
                    backgroundColor:
                      trackingStatus === "stale" ? "#71717A" : "#0A0A0B",
                  },
                ]}
              >
                <View
                  style={[
                    styles.carrierCalloutDot,
                    {
                      backgroundColor:
                        trackingStatus === "stale" ? "#F59E0B" : "#C6F24A",
                    },
                  ]}
                />
                <Text style={styles.carrierCalloutText}>
                  {carrierName} ·{" "}
                  {trackingStatus === "stale" ? "Pausado" : "En ruta"}
                </Text>
              </View>

              {/* Pin táctico con halo verde lima */}
              <View style={styles.carrierPinContainer}>
                <View
                  style={[
                    styles.carrierHalo,
                    trackingStatus === "stale" && styles.carrierHaloStale,
                  ]}
                >
                  <View style={styles.carrierInnerCircle}>
                    <Truck
                      size={18}
                      color={trackingStatus === "stale" ? "#A1A1AA" : "#C6F24A"}
                    />
                  </View>
                </View>
              </View>
            </View>
          </Marker>
        )}
      </MapView>

      {/* Píldora de Telemetría Flotante Superior (Stitch design line 24-26) */}
      <View
        testID="live-telemetry-pill"
        style={[styles.telemetryPillContainer, { top: topOffset }]}
      >
        <View
          style={[
            styles.telemetryPill,
            {
              backgroundColor: isDark
                ? "rgba(24, 24, 27, 0.94)"
                : "rgba(255, 255, 255, 0.94)",
              borderColor: isDark
                ? "rgba(255, 255, 255, 0.12)"
                : "rgba(10, 10, 11, 0.08)",
            },
          ]}
        >
          <View
            style={[styles.statusDot, { backgroundColor: statusMeta.dotBg }]}
          />
          <Text
            style={[
              styles.statusText,
              { color: isDark ? "#FFFFFF" : "#0A0A0B" },
            ]}
          >
            {statusMeta.text}
          </Text>
          <Text style={styles.dotSeparator}>·</Text>
          <Text style={styles.subText}>{statusMeta.sub}</Text>
        </View>
      </View>

      {/* Controles Flotantes Superiores: Centrar en Transportista & Vista Panorámica */}
      {showControls && (
        <View style={[styles.controlsContainer, { top: topOffset, gap: 10 }]}>
          <Pressable
            testID="btn-recenter-carrier"
            onPress={handleCenterCarrier}
            accessibilityRole="button"
            accessibilityLabel="Centrar en transportista"
            style={[
              styles.mapControlButton,
              {
                backgroundColor: isDark ? "#18181B" : "#FFFFFF",
                borderColor: isFollowingCarrier
                  ? "#C6F24A"
                  : isDark
                  ? "rgba(255,255,255,0.15)"
                  : "#E4E4E7",
                borderWidth: isFollowingCarrier ? 1.5 : 1,
              },
            ]}
          >
            <Crosshair
              size={18}
              color={isFollowingCarrier ? "#C6F24A" : isDark ? "#FFFFFF" : "#0A0A0B"}
              strokeWidth={2.4}
            />
          </Pressable>

          <Pressable
            testID="btn-view-overview"
            onPress={handleOverview}
            accessibilityRole="button"
            accessibilityLabel="Ver destino y transportista"
            style={[
              styles.mapControlButton,
              {
                backgroundColor: isDark ? "#18181B" : "#FFFFFF",
                borderColor: isDark ? "rgba(255,255,255,0.15)" : "#E4E4E7",
              },
            ]}
          >
            <Map
              size={18}
              color={isDark ? "#FFFFFF" : "#0A0A0B"}
              strokeWidth={2.2}
            />
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#F2F2F5",
  },
  destinationMarkerWrapper: {
    alignItems: "center",
  },
  destinationBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 9999,
    borderWidth: 1,
    marginBottom: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  destinationBadgeText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
  destinationPinCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    padding: 2,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 5,
  },
  destinationPinInner: {
    width: "100%",
    height: "100%",
    borderRadius: 14,
    backgroundColor: "#0A0A0B",
    alignItems: "center",
    justifyContent: "center",
  },
  destinationPinPoint: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#0A0A0B",
    marginTop: 2,
  },
  carrierMarkerWrapper: {
    alignItems: "center",
  },
  carrierCallout: {
    paddingHorizontal: 10,
    paddingVertical: 3.5,
    borderRadius: 9999,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
  },
  carrierCalloutDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  carrierCalloutText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.3,
  },
  carrierPinContainer: {
    alignItems: "center",
    justifyContent: "center",
  },
  carrierHalo: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#C6F24A",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#C6F24A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.55,
    shadowRadius: 12,
    elevation: 8,
  },
  carrierHaloStale: {
    backgroundColor: "#A1A1AA",
    shadowColor: "#000",
    shadowOpacity: 0.2,
  },
  carrierInnerCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#0A0A0B",
    alignItems: "center",
    justifyContent: "center",
  },
  telemetryPillContainer: {
    position: "absolute",
    left: 16,
    zIndex: 20,
  },
  telemetryPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 9999,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  dotSeparator: {
    color: "#A1A1AA",
    fontSize: 12,
  },
  subText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: "#71717A",
  },
  controlsContainer: {
    position: "absolute",
    right: 16,
    zIndex: 20,
  },
  mapControlButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 5,
  },
});
