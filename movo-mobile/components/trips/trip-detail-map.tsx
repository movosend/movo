import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, type LatLng } from "react-native-maps";
import { useColorScheme } from "nativewind";
import {
  MAP_EDGE_BLEED,
  MAP_GEOMETRY_COLOR_DARK,
  MAP_GEOMETRY_COLOR_LIGHT,
  movoMapStyleDark,
  movoMapStyleLight,
} from "../../src/constants/map-style";
import { useShipmentRoute } from "../../src/hooks/use-shipments";
import { decodePolyline } from "../../src/lib/polyline";
import { formatDurationMin, formatRouteDistanceKm } from "../../src/lib/shipment-format";
import type { TripWithAcceptedPackages } from "../../src/api/trips-client";
import { SkeletonBlock } from "../ui/skeleton-block";

const MAP_HEIGHT = 200;
const EDGE_PADDING = { top: 40, right: 40, bottom: 48, left: 40 };
const MAX_ZOOM_LEVEL = 20;
const ROUTE_BLUE = "#2B6BFF";

/**
 * `Marker` con vista propia: se rasteriza una vez, así que se deja de trackear tras el primer
 * render (si no, en Android redibuja el bitmap en cada frame: parpadeo y batería), con un
 * margen para que cargue el contenido. Lo usan todos los marcadores del mapa.
 */
function StaticMarker({ coordinate, children }: { coordinate: LatLng; children: ReactNode }) {
  const [track, setTrack] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setTrack(false), 600);
    return () => clearTimeout(t);
  }, []);

  return (
    <Marker coordinate={coordinate} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={track}>
      {children}
    </Marker>
  );
}

/** Marcador numerado del mockup: relleno negro = retiro, borde negro sobre blanco = entrega. */
function NumberedMarker({ n, kind, coordinate }: { n: number; kind: "pickup" | "delivery"; coordinate: LatLng }) {
  const filled = kind === "pickup";
  return (
    <StaticMarker coordinate={coordinate}>
      <View
        className={`h-[22px] w-[22px] items-center justify-center rounded-full border-2 ${
          filled ? "border-white bg-ink-950" : "border-ink-950 bg-white"
        }`}
      >
        <Text className={`font-sans-semibold text-[10px] ${filled ? "text-white" : "text-ink-950"}`}>{n}</Text>
      </View>
    </StaticMarker>
  );
}

/**
 * Mapa estático del detalle de viaje (MOVO-263 AC1): ruta origen → destino por calle y,
 * si el viaje tiene paquetes, los marcadores numerados de retiro y entrega de cada uno.
 * Sin gestos: es una vista de contexto, no un mapa de navegación.
 */
export function TripDetailMap({ trip, testID }: { trip: TripWithAcceptedPackages; testID?: string }) {
  const { colorScheme } = useColorScheme();
  const mapRef = useRef<MapView>(null);
  const origin = useMemo(() => ({ lat: trip.originLat, lng: trip.originLng }), [trip.originLat, trip.originLng]);
  const destination = useMemo(
    () => ({ lat: trip.destinationLat, lng: trip.destinationLng }),
    [trip.destinationLat, trip.destinationLng],
  );
  const packages = trip.packages ?? [];

  const { data: route, isError: routeFailed } = useShipmentRoute(origin, destination);
  const routePoints = useMemo<LatLng[]>(() => {
    if (route) return decodePolyline(route.polyline);
    // Si la ruta real falla se une origen y destino con una recta, para no dejar el mapa sin trazo.
    return routeFailed
      ? [
          { latitude: origin.lat, longitude: origin.lng },
          { latitude: destination.lat, longitude: destination.lng },
        ]
      : [];
  }, [route, routeFailed, origin, destination]);

  const fitPoints = useMemo<LatLng[]>(
    () => [
      { latitude: origin.lat, longitude: origin.lng },
      { latitude: destination.lat, longitude: destination.lng },
      ...packages.flatMap((p) => [
        { latitude: p.pickupLat, longitude: p.pickupLng },
        { latitude: p.deliveryLat, longitude: p.deliveryLng },
      ]),
    ],
    [origin, destination, packages],
  );

  // Sin gestos, si un refetch trae paquetes nuevos los marcadores quedarían fuera de cuadro:
  // se re-encuadra cuando cambian los puntos (la clave evita reaccionar a un array nuevo con
  // las mismas coordenadas). Antes de `onMapReady` no se llama: el mapa nativo todavía no existe.
  const mapReady = useRef(false);
  const fittedKey = useRef<string | null>(null);
  const fitKey = fitPoints.map((p) => `${p.latitude},${p.longitude}`).join("|");
  const fit = () => {
    fittedKey.current = fitKey;
    mapRef.current?.fitToCoordinates(fitPoints, { edgePadding: EDGE_PADDING, animated: false });
  };
  useEffect(() => {
    if (mapReady.current && fittedKey.current !== fitKey) fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `fit` lee `fitPoints`, que cambia solo con `fitKey`.
  }, [fitKey]);

  const bg = colorScheme === "dark" ? MAP_GEOMETRY_COLOR_DARK : MAP_GEOMETRY_COLOR_LIGHT;
  const isLoading = routePoints.length === 0;

  return (
    <View
      testID={testID}
      className="overflow-hidden rounded-[10px] border border-ink-950/[0.08]"
      style={{ height: MAP_HEIGHT, backgroundColor: bg }}
    >
      <MapView
        ref={mapRef}
        testID={testID ? `${testID}-map` : undefined}
        provider={PROVIDER_GOOGLE}
        customMapStyle={colorScheme === "dark" ? movoMapStyleDark : movoMapStyleLight}
        // Insets negativos: la view nativa dibuja un borde de 1px que cae fuera del recorte.
        style={{
          position: "absolute",
          top: -MAP_EDGE_BLEED,
          bottom: -MAP_EDGE_BLEED,
          left: -MAP_EDGE_BLEED,
          right: -MAP_EDGE_BLEED,
        }}
        initialRegion={{
          latitude: (origin.lat + destination.lat) / 2,
          longitude: (origin.lng + destination.lng) / 2,
          latitudeDelta: Math.max(Math.abs(origin.lat - destination.lat) * 1.8, 0.02),
          longitudeDelta: Math.max(Math.abs(origin.lng - destination.lng) * 1.8, 0.02),
        }}
        maxZoomLevel={MAX_ZOOM_LEVEL}
        onMapReady={() => {
          mapReady.current = true;
          fit();
        }}
        scrollEnabled={false}
        zoomEnabled={false}
        pitchEnabled={false}
        rotateEnabled={false}
        toolbarEnabled={false}
      >
        <Polyline coordinates={routePoints} strokeColor="#FFFFFF" strokeWidth={8} />
        <Polyline coordinates={routePoints} strokeColor={ROUTE_BLUE} strokeWidth={4} />

        <StaticMarker coordinate={{ latitude: origin.lat, longitude: origin.lng }}>
          <View className="h-4 w-4 rounded-full border-[3.5px] border-ink-950 bg-white" />
        </StaticMarker>
        <StaticMarker coordinate={{ latitude: destination.lat, longitude: destination.lng }}>
          <View className="h-6 w-6 items-center justify-center rounded-full" style={{ backgroundColor: "rgba(43,107,255,0.18)" }}>
            <View className="h-4 w-4 rounded-full border-[3px] border-white" style={{ backgroundColor: ROUTE_BLUE }} />
          </View>
        </StaticMarker>

        {packages.map((p, i) => (
          <NumberedMarker
            key={`${p.shipmentId}-pickup`}
            n={i + 1}
            kind="pickup"
            coordinate={{ latitude: p.pickupLat, longitude: p.pickupLng }}
          />
        ))}
        {packages.map((p, i) => (
          <NumberedMarker
            key={`${p.shipmentId}-delivery`}
            n={i + 1}
            kind="delivery"
            coordinate={{ latitude: p.deliveryLat, longitude: p.deliveryLng }}
          />
        ))}
      </MapView>

      {isLoading ? <SkeletonBlock className="absolute inset-0 rounded-none" /> : null}

      {route ? (
        <View className="absolute bottom-2.5 left-2.5 h-[26px] justify-center rounded-full bg-bg/90 px-2.5">
          <Text testID={testID ? `${testID}-distance` : undefined} className="font-sans text-[11px] text-fg-2">
            {formatRouteDistanceKm(route.distanceMeters)} · {formatDurationMin(route.durationSeconds)}
          </Text>
        </View>
      ) : null}

      {packages.length > 0 ? (
        <View className="absolute right-2.5 top-2.5 h-[26px] flex-row items-center gap-2.5 rounded-full bg-bg/90 px-2.5">
          <View className="flex-row items-center gap-[5px]">
            <View className="h-2 w-2 rounded-full bg-fg" />
            <Text className="font-sans text-[11px] text-fg-2">Retiro</Text>
          </View>
          <View className="flex-row items-center gap-[5px]">
            <View className="h-2 w-2 rounded-full border-[1.5px] border-fg" />
            <Text className="font-sans text-[11px] text-fg-2">Entrega</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}
