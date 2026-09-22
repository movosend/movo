import { useColorScheme } from "nativewind";
import { CheckCircle2, MapPin, Ruler } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import MapView, { Circle, Marker, PROVIDER_GOOGLE } from "react-native-maps";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { PrimaryButton } from "../auth/primary-button";
import { WizardStepHeader } from "./wizard-step-header";
import {
  MAP_EDGE_BLEED,
  MAP_GEOMETRY_COLOR_DARK,
  MAP_GEOMETRY_COLOR_LIGHT,
  movoMapStyleDark,
  movoMapStyleLight,
} from "../../src/constants/map-style";
import { PROXIMITY_THRESHOLD_METERS, useProximityCheck } from "../../src/hooks/use-proximity-check";
import { usePublicProfile } from "../../src/hooks/use-profile";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { formatProximityDistance } from "../../src/lib/shipment-format";

const PULSE_DURATION_MS = 2000;
// Más margen que `RouteMapCard` (60-80) a propósito -- este mapa es de un solo
// vistazo rápido al llegar, no necesita quedar tan pegado a los dos pines (pedido
// explícito del usuario: "saca un poquito de zoom").
const MAP_EDGE_PADDING = { top: 110, right: 90, bottom: 110, left: 90 };
const MAP_INITIAL_DELTA = 0.018;
const METERS_PER_DEGREE = 111_320;

// Tamaño base del halo y escala máxima que alcanza `LocationPulse` -- el contenedor
// del marcador "vos" (`PULSE_MARKER_SIZE`) tiene que ser al menos así de grande, si
// no `Marker` (react-native-maps) recorta todo lo que el halo dibuja fuera de los
// límites que midió al montar el contenido, con una máscara recortada en cuadrado
// (bug reportado en device: el pulso se veía "cortado").
const PULSE_BASE_SIZE = 54;
const PULSE_MAX_SCALE = 1.8;
const PULSE_MARKER_SIZE = Math.ceil(PULSE_BASE_SIZE * PULSE_MAX_SCALE) + 16;
const YOU_MARKER_WIDTH = 160;
// Alto simétrico alrededor del punto (badge arriba, espacio equivalente abajo): el centro es la coordenada.
const YOU_MARKER_HEIGHT = 2 * (PULSE_MARKER_SIZE / 2 + 40);

/** Halo pulsante detrás del marcador "vos" en el mapa real -- mismo patrón que
 * `PulsingStepRing` de `components/home/active-shipment-card.tsx` (radar en loop),
 * no un simple parpadeo de opacidad. */
function LocationPulse({ color }: { color: string }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(withTiming(1, { duration: PULSE_DURATION_MS, easing: Easing.out(Easing.ease) }), -1, false);
  }, [progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: (1 - progress.value) * 0.5,
    transform: [{ scale: 1 + progress.value * (PULSE_MAX_SCALE - 1) }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: "absolute", width: PULSE_BASE_SIZE, height: PULSE_BASE_SIZE, borderRadius: 999, backgroundColor: color },
        animatedStyle,
      ]}
    />
  );
}

function MapBadge({ label }: { label: string }) {
  return (
    <View
      className="max-w-[150px] rounded-full border border-border bg-bg px-2.5 py-1"
      style={{ shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } }}
    >
      <Text className="font-sans-medium text-[11px] text-fg" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export interface ProximityGeoScreenProps {
  /** Coordenadas del punto contra el que se valida la proximidad -- retiro
   * (`shipment.pickupLat/Lng`) o entrega (`shipment.deliveryLat/Lng`) según el
   * caller. `undefined` mientras el envío no cargó -- nunca `0`/`0` como
   * placeholder, para no confundir "sin cargar todavía" con una coordenada real. */
  targetLat: number | undefined;
  targetLng: number | undefined;
  /** Id de la contraparte cuyo nombre se muestra en el badge del pin del punto
   * (emisor en retiro, receptor en entrega) -- `usePublicProfile` resuelve el
   * nombre real cuando carga. */
  counterpartId: string | undefined;
  counterpartFallbackLabel: string;
  title: string;
  /** "Llegaste al punto de retiro" / "Llegaste al punto de entrega" -- texto
   * completo, no compuesto acá (el género de "el retiro"/"la entrega" en español no
   * se puede derivar de un solo sustantivo genérico). */
  arrivedTitle: string;
  outOfRangeHint: string;
  deniedHint: string;
  testIDPrefix: string;
  step: number;
  totalSteps: number;
  onBack: () => void;
  onContinue: () => void;
}

/**
 * Pantalla de validación de proximidad (100m) compartida por el wizard de retiro
 * (MOVO-198 AC4) y el de entrega (MOVO-199, extensión de alcance pedida
 * explícitamente por el usuario -- "es una de las características principales de
 * Movo"). Extraída de `pickup/index.tsx` en MOVO-199: no tenía nada específico de
 * pickup pese al nombre, ya recibía coordenadas por parámetro -- ver el JSDoc
 * original (historial completo de los 5 ajustes post-feedback) conservado ahí antes
 * de la extracción, en `git log` de ese archivo.
 *
 * Mapa real (`MapView`, `PROVIDER_GOOGLE`, estilo custom `movoMapStyle*`, mismo
 * truco de `MAP_EDGE_BLEED` que `RouteMapCard`), pin en el punto objetivo con badge
 * de la contraparte, pin de "vos" con halo pulsante en la ubicación GPS actual, y un
 * círculo de 100m para visualizar el rango. Un solo `PrimaryButton` por vez:
 * "Reintentar ubicación" mientras no se puede avanzar por distancia
 * (`out_of_range`/`denied`/`error`), "Continuar" (deshabilitado hasta
 * `within_range`) en el resto de los casos.
 */
export function ProximityGeoScreen({
  targetLat,
  targetLng,
  counterpartId,
  counterpartFallbackLabel,
  title,
  arrivedTitle,
  outOfRangeHint,
  deniedHint,
  testIDPrefix,
  step,
  totalSteps,
  onBack,
  onContinue,
}: ProximityGeoScreenProps) {
  const { colorScheme } = useColorScheme();
  const colors = useThemeColors();
  const mapRef = useRef<MapView>(null);
  const [mapReady, setMapReady] = useState(false);
  const mapBackgroundColor = colorScheme === "dark" ? MAP_GEOMETRY_COLOR_DARK : MAP_GEOMETRY_COLOR_LIGHT;
  const { data: counterpartProfile } = usePublicProfile(counterpartId);
  const resolvedTarget = targetLat !== undefined && targetLng !== undefined ? { lat: targetLat, lng: targetLng } : null;
  const proximity = useProximityCheck(targetLat ?? 0, targetLng ?? 0);

  useEffect(() => {
    if (resolvedTarget) void proximity.check();
    // Solo una vez, apenas se resuelve el envío -- "Reintentar" dispara el resto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!resolvedTarget]);

  // Reencuadra apenas el mapa está listo, y de nuevo cuando la ubicación actual pasa
  // de no-resuelta a resuelta (GPS suele tardar más que el montaje del `MapView`).
  useEffect(() => {
    if (!mapReady || targetLat === undefined || targetLng === undefined) return;
    // Siempre incluye los 4 extremos del círculo objetivo: el zoom mínimo es el que
    // muestra el radio completo, aunque los dos pines estén casi encimados.
    const dLat = PROXIMITY_THRESHOLD_METERS / METERS_PER_DEGREE;
    const dLng = dLat / Math.max(Math.cos((targetLat * Math.PI) / 180), 0.01);
    const points = [
      { latitude: targetLat + dLat, longitude: targetLng },
      { latitude: targetLat - dLat, longitude: targetLng },
      { latitude: targetLat, longitude: targetLng + dLng },
      { latitude: targetLat, longitude: targetLng - dLng },
      ...(proximity.currentLocation
        ? [{ latitude: proximity.currentLocation.lat, longitude: proximity.currentLocation.lng }]
        : []),
    ];
    mapRef.current?.fitToCoordinates(points, { edgePadding: MAP_EDGE_PADDING, animated: true });
  }, [mapReady, targetLat, targetLng, proximity.currentLocation]);

  const dotColor = proximity.status === "within_range" ? "#9FC72E" : proximity.status === "out_of_range" ? "#E5484D" : "#8A8A93";
  const canRetry = proximity.status === "out_of_range" || proximity.status === "denied" || proximity.status === "error";
  const statusLabel =
    proximity.status === "checking" || proximity.status === "idle"
      ? "Ubicando"
      : proximity.status === "within_range"
        ? "En el punto"
        : "Fuera de rango";

  return (
    <SafeAreaView className="flex-1 bg-bg">
      <WizardStepHeader testIDPrefix={testIDPrefix} title={title} step={step} totalSteps={totalSteps} onBack={onBack} />

      <View className="flex-1 overflow-hidden" style={{ backgroundColor: mapBackgroundColor }}>
        {resolvedTarget ? (
          <MapView
            ref={mapRef}
            testID={`${testIDPrefix}-map`}
            provider={PROVIDER_GOOGLE}
            customMapStyle={colorScheme === "dark" ? movoMapStyleDark : movoMapStyleLight}
            style={{
              position: "absolute",
              top: -MAP_EDGE_BLEED,
              bottom: -MAP_EDGE_BLEED,
              left: -MAP_EDGE_BLEED,
              right: -MAP_EDGE_BLEED,
            }}
            initialRegion={{
              latitude: resolvedTarget.lat,
              longitude: resolvedTarget.lng,
              latitudeDelta: MAP_INITIAL_DELTA,
              longitudeDelta: MAP_INITIAL_DELTA,
            }}
            onMapReady={() => setMapReady(true)}
            scrollEnabled
            zoomEnabled
            pitchEnabled={false}
            rotateEnabled={false}
          >
            <Circle
              center={{ latitude: resolvedTarget.lat, longitude: resolvedTarget.lng }}
              radius={PROXIMITY_THRESHOLD_METERS}
              strokeColor="rgba(10, 10, 11, 0.22)"
              fillColor="rgba(10, 10, 11, 0.05)"
              strokeWidth={1}
            />

            <Marker
              testID={`${testIDPrefix}-map-target-marker`}
              coordinate={{ latitude: resolvedTarget.lat, longitude: resolvedTarget.lng }}
              anchor={{ x: 0.5, y: 1 }}
            >
              <View className="items-center">
                <View className="mb-2">
                  <MapBadge label={counterpartProfile?.fullName ?? counterpartFallbackLabel} />
                </View>
                <View className="h-6 w-6 rounded-full border-[3px] border-white bg-ink-950 dark:border-ink-950 dark:bg-white" />
              </View>
            </Marker>

            {proximity.currentLocation ? (
              <Marker
                testID={`${testIDPrefix}-map-you-marker`}
                coordinate={{ latitude: proximity.currentLocation.lat, longitude: proximity.currentLocation.lng }}
                anchor={{ x: 0.5, y: 0.5 }}
                // A diferencia de `route-map.tsx` (PR #169), acá `tracksViewChanges` no
                // se puede apagar tras el render inicial: `LocationPulse` anima en loop
                // infinito (`withRepeat`), y `Marker` solo rasteriza contenido nuevo en
                // el mapa cuando `tracksViewChanges` está activo -- apagarlo congelaría
                // el halo en su primer frame. Decisión consciente, no un olvido
                // (feedback de review, PR #180).
                tracksViewChanges
              >
                <View style={{ width: YOU_MARKER_WIDTH, height: YOU_MARKER_HEIGHT }}>
                  {/* Badge pegado al punto (24px de diámetro), independiente del tamaño del halo. */}
                  <View
                    pointerEvents="none"
                    className="absolute items-center justify-end"
                    style={{ left: 0, right: 0, bottom: YOU_MARKER_HEIGHT / 2 + 12 + 6 }}
                  >
                    <MapBadge label="Vos" />
                  </View>
                  <View className="absolute items-center justify-center" style={{ left: 0, right: 0, top: 0, bottom: 0 }}>
                    <LocationPulse color={dotColor === "#9FC72E" ? "rgba(198,242,74,0.45)" : "rgba(229,72,77,0.3)"} />
                    <View
                      className="rounded-full border-[3px] border-white"
                      style={{ backgroundColor: dotColor, width: 24, height: 24 }}
                    />
                  </View>
                </View>
              </Marker>
            ) : null}
          </MapView>
        ) : (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="small" color={colors.fg2} />
          </View>
        )}

        <View pointerEvents="none" className="absolute inset-x-0 bottom-4 items-center">
          <View
            testID={`${testIDPrefix}-map-status`}
            className="flex-row items-center gap-2 rounded-full bg-bg px-3.5 py-2"
            style={{ shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } }}
          >
            <View className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: dotColor }} />
            <Text className="font-sans-semibold text-caption uppercase text-fg-2">{statusLabel}</Text>
            {proximity.distanceMeters !== null ? (
              <>
                <View className="h-3 w-px bg-border" />
                <View className="flex-row items-center gap-1">
                  <Ruler size={14} color={colors.fg2} strokeWidth={1.8} />
                  <Text testID={`${testIDPrefix}-map-distance`} className="font-sans-semibold text-[13px] text-fg">
                    {formatProximityDistance(proximity.distanceMeters)}
                  </Text>
                </View>
              </>
            ) : null}
          </View>
        </View>
      </View>

      <View className="gap-3.5 border-t border-border bg-bg px-5 pb-2 pt-4">
        <View className="flex-row items-center gap-3.5">
          {proximity.status === "checking" || proximity.status === "idle" ? (
            <ActivityIndicator testID={`${testIDPrefix}-spinner`} size="small" color={colors.fg2} />
          ) : proximity.status === "within_range" ? (
            <View className="items-center justify-center rounded-full bg-lime-500" style={{ width: 26, height: 26 }}>
              <CheckCircle2 size={16} color="#0A0A0B" strokeWidth={2.6} />
            </View>
          ) : (
            <View className="items-center justify-center rounded-full bg-danger-100" style={{ width: 26, height: 26 }}>
              <MapPin size={15} color="#E5484D" strokeWidth={2.2} />
            </View>
          )}
          <View className="flex-1 gap-0.5">
            <Text className="font-sans-semibold text-[15px] text-fg">
              {proximity.status === "checking" || proximity.status === "idle"
                ? "Buscando tu ubicación"
                : proximity.status === "within_range"
                  ? arrivedTitle
                  : proximity.status === "out_of_range"
                    ? `Estás a ${formatProximityDistance(proximity.distanceMeters ?? 0)} del punto`
                    : proximity.status === "denied"
                      ? "Necesitamos tu ubicación"
                      : "No pudimos confirmar tu ubicación"}
            </Text>
            <Text className="font-sans text-small text-fg-2">
              {proximity.status === "checking" || proximity.status === "idle"
                ? "Necesitamos el GPS para confirmar que llegaste."
                : proximity.status === "within_range"
                  ? "Ya podés continuar."
                  : proximity.status === "out_of_range"
                    ? outOfRangeHint
                    : proximity.status === "denied"
                      ? deniedHint
                      : "Intentá de nuevo."}
            </Text>
          </View>
        </View>
      </View>

      {canRetry ? (
        <PrimaryButton
          testID={`${testIDPrefix}-retry`}
          label="Reintentar ubicación"
          onPress={() => void proximity.check()}
        />
      ) : (
        <PrimaryButton
          testID={`${testIDPrefix}-continue`}
          label="Continuar"
          disabled={proximity.status !== "within_range"}
          onPress={onContinue}
        />
      )}
    </SafeAreaView>
  );
}
