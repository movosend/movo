import { useRef } from "react";
import { Pressable, View } from "react-native";
import MapView, { PROVIDER_GOOGLE, type LatLng } from "react-native-maps";
import { useColorScheme } from "nativewind";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Crosshair, X } from "lucide-react-native";
import type { ReactNode } from "react";
import { movoMapStyleDark, movoMapStyleLight } from "../../src/constants/map-style";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

const MAX_ZOOM_LEVEL = 20;
const CONTROL_SHADOW = { shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } };

interface FullscreenMapProps {
  /** Puntos que el encuadre inicial (y el botón de recentrar) tiene que dejar a la vista. */
  fitPoints: LatLng[];
  /** Polylines y marcadores, los mismos que dibuja el mapa de la card. */
  children: ReactNode;
  onClose: () => void;
  testID?: string;
}

/**
 * Mapa a pantalla completa de los detalles (ruta del envío, detalle de viaje): gestos
 * libres (pan, zoom, rotación) y los dos controles mínimos — cerrar y recentrar sobre la
 * ruta. Lo monta `ExpandableMap` dentro de su modal; no sabe nada de la animación.
 */
export function FullscreenMap({ fitPoints, children, onClose, testID }: FullscreenMapProps) {
  const { colorScheme } = useColorScheme();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);

  const fit = (animated: boolean) => {
    if (fitPoints.length === 0) return;
    mapRef.current?.fitToCoordinates(fitPoints, {
      edgePadding: { top: insets.top + 72, right: 56, bottom: insets.bottom + 72, left: 56 },
      animated,
    });
  };

  return (
    <View className="flex-1">
      <MapView
        ref={mapRef}
        testID={testID ? `${testID}-map` : undefined}
        style={{ flex: 1 }}
        provider={PROVIDER_GOOGLE}
        customMapStyle={colorScheme === "dark" ? movoMapStyleDark : movoMapStyleLight}
        maxZoomLevel={MAX_ZOOM_LEVEL}
        onMapReady={() => fit(false)}
        scrollEnabled
        zoomEnabled
        rotateEnabled
        pitchEnabled={false}
        showsBuildings={false}
        showsTraffic={false}
        showsIndoors={false}
        showsCompass={false}
        toolbarEnabled={false}
        moveOnMarkerPress={false}
      >
        {children}
      </MapView>

      <Pressable
        testID={testID ? `${testID}-close` : undefined}
        onPress={onClose}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Cerrar mapa"
        className="absolute left-4 h-11 w-11 items-center justify-center rounded-full bg-bg active:opacity-80"
        style={[{ top: insets.top + 8 }, CONTROL_SHADOW]}
      >
        <X size={20} color={colors.fg1} strokeWidth={2} />
      </Pressable>

      <Pressable
        testID={testID ? `${testID}-recenter` : undefined}
        onPress={() => fit(true)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Recentrar ruta"
        className="absolute right-4 h-11 w-11 items-center justify-center rounded-full bg-bg active:opacity-80"
        style={[{ bottom: insets.bottom + 16 }, CONTROL_SHADOW]}
      >
        <Crosshair size={20} color={colors.fg1} strokeWidth={1.8} />
      </Pressable>
    </View>
  );
}
