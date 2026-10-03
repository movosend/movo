import { Pencil } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, type LatLng } from "react-native-maps";
import Animated, { processColor, useAnimatedProps, useFrameCallback, useSharedValue } from "react-native-reanimated";
import { useColorScheme } from "nativewind";
import {
  MAP_EDGE_BLEED,
  MAP_GEOMETRY_COLOR_DARK,
  MAP_GEOMETRY_COLOR_LIGHT,
  movoMapStyleDark,
  movoMapStyleLight,
} from "../../src/constants/map-style";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { useShipmentRoute } from "../../src/hooks/use-shipments";
import { hexToRgba } from "../../src/lib/color";
import { decodePolyline } from "../../src/lib/polyline";
import { SkeletonBlock } from "../ui/skeleton-block";

const AnimatedPolyline = Animated.createAnimatedComponent(Polyline);

const MAP_HEIGHT = 220;
const EDGE_PADDING = { top: 64, right: 48, bottom: 40, left: 48 };
// Cuánto se puede alejar el mapa por debajo del zoom que encuadra la ruta. No es un
// `minZoomLevel` fijo porque las rutas van de unas cuadras a más de 100 km: el mínimo
// sale del encuadre real de cada ruta (un nivel = el doble de área visible).
const EXTRA_ZOOM_OUT_LEVELS = 1;
// Máximo explícito, siempre: en iOS (Google Maps, Fabric) `minZoomLevel` y
// `maxZoomLevel` se aplican juntos, y sin `maxZoomLevel` el máximo queda en 0. Fijar un
// mínimo mayor que ese 0 hace que Google Maps tire una excepción nativa y la app se
// cierre. 20 es el máximo que soporta Google Maps.
const MAX_ZOOM_LEVEL = 20;

// Si la ruta real (`GET /shipments/route`, MOVO-123) falla, se interpola una línea recta
// para no dejar el mapa sin trazo. Mientras la ruta todavía está cargando NO se dibuja
// esa recta: se veía una línea recta que segundos después era reemplazada de golpe por
// la ruta por calle. En su lugar, un skeleton tapa todo el mapa hasta que hay trazo.
const FALLBACK_ROUTE_STEPS = 24;
// Ciclo del barrido (referencia: comparativa "before/after" de Uber) — un trazo negro se
// dibuja progresivamente de punta a punta sobre la línea gris de base, se mantiene un
// instante completo y se desvanece antes de reiniciar. Medido sobre el gif de
// referencia: ~1.8s de dibujado, ~0.4s sostenido, ~1.4s de fade.
const SWEEP_DRAW_MS = 1800;
const SWEEP_HOLD_MS = 400;
const SWEEP_FADE_MS = 1400;
const SWEEP_TOTAL_MS = SWEEP_DRAW_MS + SWEEP_HOLD_MS + SWEEP_FADE_MS;

// `worklet`: además de usarse al armar la ruta fallback (JS thread), la reusa el
// worklet de `useAnimatedProps` de abajo (UI thread) para no duplicar la fórmula.
function interpolate(a: number, b: number, t: number) {
  "worklet";
  return a + (b - a) * t;
}

/** Subconjunto de `AddressSelection` (`src/types/address-selection.ts`) que el mapa
 * realmente necesita — desacoplado del wizard a propósito para que otros callers
 * (detalle de envío, MOVO-127) no tengan que fabricar un `source` que este
 * componente nunca usa. `AddressSelection` sigue siendo asignable acá (tipado
 * estructural), así que el wizard no necesita ningún cambio. */
interface RoutePoint {
  address: string;
  lat: number;
  lng: number;
}

function buildFallbackRoutePoints(pickup: RoutePoint, delivery: RoutePoint): LatLng[] {
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
  pickup: RoutePoint | null;
  delivery: RoutePoint | null;
  /** Sin `onEdit` no se renderiza el botón flotante de lápiz — el detalle de envío
   * (MOVO-127) reusa este mapa en modo solo lectura, la ruta ya está fijada. */
  onEdit?: () => void;
  /** Con `pickup={null}` y este texto, el mapa muestra solo el punto de entrega y el
   * retiro queda como una línea de texto debajo, sin pin ni coordenadas: la vista del
   * receptor no expone el retiro exacto (MOVO-194 AC4). */
  pickupLabel?: string;
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
export function RouteMapCard({ pickup, delivery, onEdit, pickupLabel, testID }: RouteMapCardProps) {
  const { colorScheme } = useColorScheme();
  const colors = useThemeColors();
  const mapRef = useRef<MapView>(null);
  const [minZoomLevel, setMinZoomLevel] = useState<number | undefined>(undefined);
  const mapBackgroundColor = colorScheme === "dark" ? MAP_GEOMETRY_COLOR_DARK : MAP_GEOMETRY_COLOR_LIGHT;

  const { data: route, isError: routeFailed } = useShipmentRoute(
    pickup ? { lat: pickup.lat, lng: pickup.lng } : null,
    delivery ? { lat: delivery.lat, lng: delivery.lng } : null,
  );

  // Progreso del barrido en shared values (UI thread) en vez de `useState` — la
  // versión anterior llamaba `setState` en cada `requestAnimationFrame` (hasta 60
  // veces por segundo), re-renderizando todo `RouteMapCard` (`MapView`,
  // `Marker`s, `Polyline`s) en el JS thread por cada frame. `useFrameCallback` corre
  // el mismo cálculo de barrido en el UI thread sin tocar React; `useAnimatedProps`
  // empuja el resultado directo a `AnimatedPolyline` vía `setNativeProps`, también sin
  // re-render de React.
  const sweepLength = useSharedValue(0);
  const sweepOpacity = useSharedValue(1);
  const startedAt = useSharedValue<number | null>(null);

  const frameCallback = useFrameCallback((frameInfo) => {
    if (startedAt.value === null) startedAt.value = frameInfo.timestamp;
    const elapsed = (frameInfo.timestamp - startedAt.value) % SWEEP_TOTAL_MS;
    if (elapsed < SWEEP_DRAW_MS) {
      sweepLength.value = elapsed / SWEEP_DRAW_MS;
      sweepOpacity.value = 1;
    } else if (elapsed < SWEEP_DRAW_MS + SWEEP_HOLD_MS) {
      sweepLength.value = 1;
      sweepOpacity.value = 1;
    } else {
      const fadeT = (elapsed - SWEEP_DRAW_MS - SWEEP_HOLD_MS) / SWEEP_FADE_MS;
      sweepLength.value = 1;
      sweepOpacity.value = 1 - fadeT;
    }
  }, false);

  // Calculado antes del early return de abajo: los hooks (`useAnimatedProps`) no
  // pueden ser condicionales, así que `routePoints` se resuelve acá con `pickup`/
  // `delivery` todavía potencialmente `null` (ruta vacía en ese caso — nunca se
  // llega a renderizar el mapa que la usaría). Vacía también mientras la ruta carga.
  const routePoints = useMemo(() => {
    if (!pickup || !delivery) return [];
    if (route) return decodePolyline(route.polyline);
    return routeFailed ? buildFallbackRoutePoints(pickup, delivery) : [];
  }, [pickup, delivery, route, routeFailed]);
  const isRouteLoading = Boolean(pickup && delivery) && routePoints.length === 0;

  // Cada vez que aparece un trazo nuevo, el barrido arranca de cero desde el origen.
  useEffect(() => {
    startedAt.value = null;
    sweepLength.value = 0;
    frameCallback.setActive(routePoints.length > 0);
  }, [routePoints, frameCallback, startedAt, sweepLength]);

  // La punta del barrido interpola entre los dos puntos de ruta más cercanos en vez de
  // saltar de punto en punto — con pocos puntos (ruta fallback, o un polyline real con
  // segmentos largos) redondear al índice más cercano se veía "a los tirones". Corre
  // como worklet en el UI thread: `sweepLength`/`sweepOpacity` cambian en cada frame
  // (`useFrameCallback` arriba) y este cálculo se vuelve a correr ahí mismo, sin pasar
  // por React.
  // `strokeColor` no está en la allowlist `ColorProperties` de Reanimated (es un prop
  // custom de `react-native-maps`, no un estilo estándar) — `useAnimatedProps` solo le
  // aplica `processColor` automáticamente a los props de esa lista, así que sin llamarlo
  // acá a mano el string `rgba(...)` cruza tal cual al lado nativo. En iOS, el view
  // manager de `Polyline` no logra parsearlo y el `GMSPolyline` cae a su azul por
  // defecto — se ve como un bug de color pero es un string sin procesar.
  const animatedSweepProps = useAnimatedProps<{ coordinates: LatLng[]; strokeColor: string }>(() => {
    "worklet";
    // `processColor` devuelve el int nativo que espera el view manager, no un string —
    // el tipo de `Polyline#strokeColor` (react-native-maps) sigue siendo `string` porque
    // así lo tipa la librería para el caso no-animado, así que se castea acá.
    const nativeStrokeColor = processColor(
      hexToRgba(colors.fg1, sweepOpacity.value),
    ) as unknown as string;
    const routeSteps = routePoints.length - 1;
    if (routeSteps < 0) return { coordinates: [], strokeColor: nativeStrokeColor };
    const rawIdx = sweepLength.value * routeSteps;
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
    return {
      coordinates: sweepPoints,
      strokeColor: nativeStrokeColor,
    };
  }, [routePoints, colors.fg1]);

  const deliveryOnly = !pickup && !!delivery && pickupLabel !== undefined;

  if (!delivery || (!pickup && !deliveryOnly)) {
    return (
      <View
        testID={testID}
        className="items-center justify-center rounded-[14px] border border-dashed border-border-strong bg-bg-sub px-4 py-8"
      >
        <Text className="font-sans-medium text-[13px] text-fg-3">Definí el origen y destino para ver la ruta</Text>
      </View>
    );
  }

  return (
    <View testID={testID} className="overflow-hidden rounded-[14px] border border-border">
      <View style={{ height: MAP_HEIGHT, backgroundColor: mapBackgroundColor }}>
        <MapView
          ref={mapRef}
          testID={testID ? `${testID}-map` : undefined}
          provider={PROVIDER_GOOGLE}
          customMapStyle={colorScheme === "dark" ? movoMapStyleDark : movoMapStyleLight}
          // Insets negativos en vez de `flex: 1`: el borde propio de la view nativa
          // (línea blanca de 1px) cae fuera del recorte del contenedor. Ver
          // `MAP_EDGE_BLEED`.
          style={{
            position: "absolute",
            top: -MAP_EDGE_BLEED,
            bottom: -MAP_EDGE_BLEED,
            left: -MAP_EDGE_BLEED,
            right: -MAP_EDGE_BLEED,
          }}
          initialRegion={
            pickup
              ? {
                  latitude: (pickup.lat + delivery.lat) / 2,
                  longitude: (pickup.lng + delivery.lng) / 2,
                  latitudeDelta: Math.max(Math.abs(pickup.lat - delivery.lat) * 1.8, 0.02),
                  longitudeDelta: Math.max(Math.abs(pickup.lng - delivery.lng) * 1.8, 0.02),
                }
              : { latitude: delivery.lat, longitude: delivery.lng, latitudeDelta: 0.02, longitudeDelta: 0.02 }
          }
          minZoomLevel={minZoomLevel}
          maxZoomLevel={MAX_ZOOM_LEVEL}
          onMapReady={() => {
            const map = mapRef.current;
            if (!map || !pickup) return;
            map.fitToCoordinates([pickup, delivery].map((p) => ({ latitude: p.lat, longitude: p.lng })), {
              edgePadding: EDGE_PADDING,
              animated: false,
            });
            // El zoom del encuadre recién se puede leer después de aplicarlo.
            requestAnimationFrame(() => {
              map
                .getCamera()
                .then((camera) => {
                  if (typeof camera.zoom === "number" && Number.isFinite(camera.zoom)) {
                    setMinZoomLevel(Math.min(Math.max(camera.zoom - EXTRA_ZOOM_OUT_LEVELS, 0), MAX_ZOOM_LEVEL));
                  }
                })
                .catch(() => {
                  // Sin cámara no se limita el zoom: el mapa sigue usable, solo sin tope.
                });
            });
          }}
          scrollEnabled
          zoomEnabled
          pitchEnabled={false}
          rotateEnabled={false}
        >
          {pickup ? (
            <>
              <Polyline
                testID={testID ? `${testID}-route-base` : undefined}
                coordinates={routePoints}
                strokeColor={colors.fg3}
                strokeWidth={3.5}
              />
              <AnimatedPolyline
                coordinates={routePoints}
                strokeColor={hexToRgba(colors.fg1, 1)}
                strokeWidth={3.5}
                animatedProps={animatedSweepProps}
              />

              <Marker coordinate={{ latitude: pickup.lat, longitude: pickup.lng }} anchor={{ x: 0.5, y: 1 }}>
                <View className="items-center">
                  <View className="mb-1.5">
                    <RouteBadge label={pickup.address} />
                  </View>
                  <View className="h-3.5 w-3.5 rounded-full border-2 border-white bg-ink-950 dark:border-ink-950 dark:bg-white" />
                </View>
              </Marker>
            </>
          ) : null}
          <Marker coordinate={{ latitude: delivery.lat, longitude: delivery.lng }} anchor={{ x: 0.5, y: 1 }}>
            <View className="items-center">
              <View className="mb-1.5">
                <RouteBadge label={delivery.address} />
              </View>
              <View className="h-3.5 w-3.5 rounded-[3px] border-2 border-white bg-ink-950 dark:border-ink-950 dark:bg-white" />
            </View>
          </Marker>
        </MapView>

        {isRouteLoading ? (
          <SkeletonBlock
            testID={testID ? `${testID}-route-loading` : undefined}
            className="absolute inset-0"
          />
        ) : null}

        {onEdit ? (
          <Pressable
            testID={testID ? `${testID}-edit` : undefined}
            onPress={onEdit}
            hitSlop={8}
            className="absolute right-3 top-3 h-9 w-9 items-center justify-center rounded-full bg-bg"
            style={{ shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } }}
          >
            <Pencil size={16} color={colors.fg1} strokeWidth={1.8} />
          </Pressable>
        ) : null}
      </View>

      {deliveryOnly ? (
        <View
          testID={testID ? `${testID}-pickup-label` : undefined}
          className="flex-row items-center gap-2 border-t border-border bg-bg px-3.5 py-3"
        >
          <View className="h-2.5 w-2.5 rounded-full border-2 border-fg-3" />
          <Text className="flex-1 font-sans text-[12.5px] text-fg-2" numberOfLines={1}>
            Retiro en {pickupLabel}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
