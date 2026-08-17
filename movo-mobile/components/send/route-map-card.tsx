import { Pencil } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, type LatLng } from "react-native-maps";
import { useColorScheme } from "nativewind";
import { movoMapStyleDark, movoMapStyleLight } from "../../src/constants/map-style";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { useShipmentRoute } from "../../src/hooks/use-shipments";
import { hexToRgba } from "../../src/lib/color";
import { decodePolyline } from "../../src/lib/polyline";
import type { AddressSelection } from "../../src/store/shipment-wizard-store";

const MAP_HEIGHT = 220;
const EDGE_PADDING = { top: 64, right: 48, bottom: 40, left: 48 };

// Cuando todavía no llegó la ruta real (`GET /shipments/route`, MOVO-123) o falló, se
// interpola una línea recta como placeholder — se ve peor pero nunca deja el mapa vacío.
const FALLBACK_ROUTE_STEPS = 24;
// Ciclo del barrido (referencia: comparativa "before/after" de Uber) — un trazo negro se
// dibuja progresivamente de punta a punta sobre la línea gris de base, se mantiene un
// instante completo y se desvanece antes de reiniciar. Medido sobre el gif de
// referencia: ~1.8s de dibujado, ~0.4s sostenido, ~1.4s de fade.
const SWEEP_DRAW_MS = 1800;
const SWEEP_HOLD_MS = 400;
const SWEEP_FADE_MS = 1400;
const SWEEP_TOTAL_MS = SWEEP_DRAW_MS + SWEEP_HOLD_MS + SWEEP_FADE_MS;

function interpolate(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function buildFallbackRoutePoints(pickup: AddressSelection, delivery: AddressSelection): LatLng[] {
  const points: LatLng[] = [];
  for (let i = 0; i <= FALLBACK_ROUTE_STEPS; i += 1) {
    const t = i / FALLBACK_ROUTE_STEPS;
    points.push({
      latitude: interpolate(pickup.lat, delivery.lat, t),
      longitude: interpolate(pickup.lng, delivery.lng, t),
    });
  }
  return points;
}

function RouteBadge({ label }: { label: string }) {
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

interface RouteMapCardProps {
  pickup: AddressSelection | null;
  delivery: AddressSelection | null;
  onEdit: () => void;
  testID?: string;
}

/**
 * Card hero del paso de resumen (MOVO-83, feedback de UI post-implementación x2):
 * mapa con la ruta real por calle origen→entrega (MOVO-123, `GET /shipments/route`).
 * La línea de base (color `fg-3`, mismo mute gris que las labels del mapa en ambos
 * temas) queda siempre visible de punta a punta; encima se anima un barrido con el
 * color de mayor contraste del tema (`fg-1` — negro en claro, blanco en oscuro) que se
 * dibuja progresivamente desde el origen hasta el destino, se desvanece y vuelve a
 * arrancar en loop (referencia: comparativa "before/after" de Uber). Cada punto muestra
 * su dirección como badge flotante sobre el mapa (no en filas debajo) — un punto para
 * el origen, un cuadrado para el destino, mismo color `fg-1` a propósito (se
 * distinguen por forma, no por color).
 */
export function RouteMapCard({ pickup, delivery, onEdit, testID }: RouteMapCardProps) {
  const { colorScheme } = useColorScheme();
  const colors = useThemeColors();
  const mapRef = useRef<MapView>(null);
  const [sweep, setSweep] = useState({ length: 0, opacity: 1 });

  const { data: route } = useShipmentRoute(
    pickup ? { lat: pickup.lat, lng: pickup.lng } : null,
    delivery ? { lat: delivery.lat, lng: delivery.lng } : null,
  );

  useEffect(() => {
    if (!pickup || !delivery) return;
    // requestAnimationFrame en vez de setInterval: corre atado al refresh real del
    // dispositivo (hasta 60fps) en lugar de un intervalo fijo de JS, y al basarse en
    // el tiempo transcurrido real (no en cuántos ticks pasaron) no se nota "a los
    // saltos" si el JS thread se atrasa un frame — el próximo tick recalcula la
    // posición correcta en vez de arrastrar el retraso.
    let rafId: number;
    const startedAt = Date.now();
    const tick = () => {
      const elapsed = (Date.now() - startedAt) % SWEEP_TOTAL_MS;
      if (elapsed < SWEEP_DRAW_MS) {
        setSweep({ length: elapsed / SWEEP_DRAW_MS, opacity: 1 });
      } else if (elapsed < SWEEP_DRAW_MS + SWEEP_HOLD_MS) {
        setSweep({ length: 1, opacity: 1 });
      } else {
        const fadeT = (elapsed - SWEEP_DRAW_MS - SWEEP_HOLD_MS) / SWEEP_FADE_MS;
        setSweep({ length: 1, opacity: 1 - fadeT });
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [pickup, delivery]);

  if (!pickup || !delivery) {
    return (
      <View
        testID={testID}
        className="items-center justify-center rounded-[14px] border border-dashed border-border-strong bg-bg-sub px-4 py-8"
      >
        <Text className="font-sans-medium text-[13px] text-fg-3">Definí el origen y destino para ver la ruta</Text>
      </View>
    );
  }

  const routePoints = route ? decodePolyline(route.polyline) : buildFallbackRoutePoints(pickup, delivery);
  const routeSteps = routePoints.length - 1;
  // La punta del barrido interpola entre los dos puntos de ruta más cercanos en vez de
  // saltar de punto en punto — con pocos puntos (ruta fallback, o un polyline real con
  // segmentos largos) redondear al índice más cercano se veía "a los tirones".
  const rawIdx = sweep.length * routeSteps;
  const sweepFloorIdx = Math.min(routeSteps, Math.floor(rawIdx));
  const sweepFrac = rawIdx - sweepFloorIdx;
  const sweepPoints = routePoints.slice(0, sweepFloorIdx + 1);
  if (sweepFloorIdx < routeSteps) {
    const from = routePoints[sweepFloorIdx];
    const to = routePoints[sweepFloorIdx + 1];
    sweepPoints.push({
      latitude: interpolate(from.latitude, to.latitude, sweepFrac),
      longitude: interpolate(from.longitude, to.longitude, sweepFrac),
    });
  }

  return (
    <View testID={testID} className="overflow-hidden rounded-[14px] border border-border">
      <View style={{ height: MAP_HEIGHT }}>
        <MapView
          ref={mapRef}
          testID={testID ? `${testID}-map` : undefined}
          provider={PROVIDER_GOOGLE}
          customMapStyle={colorScheme === "dark" ? movoMapStyleDark : movoMapStyleLight}
          style={{ flex: 1 }}
          initialRegion={{
            latitude: (pickup.lat + delivery.lat) / 2,
            longitude: (pickup.lng + delivery.lng) / 2,
            latitudeDelta: Math.max(Math.abs(pickup.lat - delivery.lat) * 1.8, 0.02),
            longitudeDelta: Math.max(Math.abs(pickup.lng - delivery.lng) * 1.8, 0.02),
          }}
          onMapReady={() =>
            mapRef.current?.fitToCoordinates([pickup, delivery].map((p) => ({ latitude: p.lat, longitude: p.lng })), {
              edgePadding: EDGE_PADDING,
              animated: false,
            })
          }
          scrollEnabled
          zoomEnabled
          pitchEnabled={false}
          rotateEnabled={false}
        >
          <Polyline coordinates={routePoints} strokeColor={colors.fg3} strokeWidth={3.5} />
          <Polyline coordinates={sweepPoints} strokeColor={hexToRgba(colors.fg1, sweep.opacity)} strokeWidth={3.5} />

          <Marker coordinate={{ latitude: pickup.lat, longitude: pickup.lng }} anchor={{ x: 0.5, y: 1 }}>
            <View className="items-center">
              <View className="mb-1.5">
                <RouteBadge label={pickup.address} />
              </View>
              <View className="h-3.5 w-3.5 rounded-full border-2 border-white bg-ink-950 dark:border-ink-950 dark:bg-white" />
            </View>
          </Marker>
          <Marker coordinate={{ latitude: delivery.lat, longitude: delivery.lng }} anchor={{ x: 0.5, y: 1 }}>
            <View className="items-center">
              <View className="mb-1.5">
                <RouteBadge label={delivery.address} />
              </View>
              <View className="h-3.5 w-3.5 rounded-[3px] border-2 border-white bg-ink-950 dark:border-ink-950 dark:bg-white" />
            </View>
          </Marker>
        </MapView>

        <Pressable
          testID={testID ? `${testID}-edit` : undefined}
          onPress={onEdit}
          hitSlop={8}
          className="absolute right-3 top-3 h-9 w-9 items-center justify-center rounded-full bg-bg"
          style={{ shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } }}
        >
          <Pencil size={16} color={colors.fg1} strokeWidth={1.8} />
        </Pressable>
      </View>
    </View>
  );
}
