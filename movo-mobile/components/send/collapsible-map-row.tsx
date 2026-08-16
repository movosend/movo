import { MapPin } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from "react-native-maps";
import { useColorScheme } from "nativewind";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { movoMapStyleDark, movoMapStyleLight } from "../../src/constants/map-style";

const MAP_HEIGHT = 320;
const ANIMATION_MS = 250;

// Córdoba Capital, Argentina — mismo fallback que el paso de mapa del registro
// (`app/(auth)/register.tsx`) para cuando todavía no hay ningún pin.
const FALLBACK_REGION: Region = { latitude: -31.4201, longitude: -64.1888, latitudeDelta: 0.01, longitudeDelta: 0.01 };

interface CollapsibleMapRowProps {
  dotColor: string;
  label: string;
  address: string;
  lat: number | null;
  lng: number | null;
  onConfirm: (lat: number, lng: number) => void;
  testID?: string;
  /** Se monta y expande solo, sin esperar el tap del header propio — usado por
   * `address-field.tsx`, que ya tiene su propia fila colapsada ("Ajustar en el
   * mapa") y no quiere una segunda fila redundante encima del mapa. */
  autoExpand?: boolean;
}

/**
 * Fila colapsada por defecto (label + dirección + ícono de mapa) que expande a un
 * `MapView` con un pin arrastrable — misma mecánica que el paso 3 de
 * `app/(auth)/register.tsx` (`PROVIDER_GOOGLE` forzado, `customMapStyle` según tema),
 * pero animada (pedido explícito del usuario, MOVO-83) en vez de aparecer/desaparecer
 * de golpe. El `MapView` solo se monta mientras la fila está expandida o
 * expandiéndose — evita pagar el costo de montaje de dos mapas (retiro+entrega) si el
 * usuario nunca los abre.
 */
export function CollapsibleMapRow({
  dotColor,
  label,
  address,
  lat,
  lng,
  onConfirm,
  testID,
  autoExpand = false,
}: CollapsibleMapRowProps) {
  const { colorScheme } = useColorScheme();
  const [mounted, setMounted] = useState(false);
  const [draftLat, setDraftLat] = useState(lat);
  const [draftLng, setDraftLng] = useState(lng);
  const height = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({ height: height.value }));

  const expand = () => {
    setDraftLat(lat ?? FALLBACK_REGION.latitude);
    setDraftLng(lng ?? FALLBACK_REGION.longitude);
    setMounted(true);
    height.value = withTiming(MAP_HEIGHT, { duration: ANIMATION_MS, easing: Easing.out(Easing.cubic) });
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (autoExpand) expand();
  }, []);

  const collapse = () => {
    height.value = withTiming(0, { duration: ANIMATION_MS, easing: Easing.out(Easing.cubic) }, (finished) => {
      if (finished) runOnJS(setMounted)(false);
    });
  };

  const handleConfirm = () => {
    if (draftLat !== null && draftLng !== null) {
      onConfirm(draftLat, draftLng);
    }
    collapse();
  };

  return (
    <View>
      {autoExpand ? null : (
        <Pressable
          testID={testID}
          onPress={mounted ? collapse : expand}
          className="flex-row items-center gap-3 px-4 py-3.5"
        >
          <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: dotColor }} />
          <View className="flex-1">
            <Text className="mb-0.5 font-sans text-[11px] text-fg-3">{label}</Text>
            <Text className="font-sans-medium text-[15px] text-fg" numberOfLines={1}>
              {address || "Sin definir"}
            </Text>
          </View>
          <MapPin size={16} color="#8A8A93" strokeWidth={1.8} />
        </Pressable>
      )}

      <Animated.View style={[{ overflow: "hidden" }, animatedStyle]}>
        {mounted ? (
          <View className="mx-4 mb-3.5 h-80 overflow-hidden rounded-[10px]">
            <MapView
              testID={testID ? `${testID}-map` : undefined}
              provider={PROVIDER_GOOGLE}
              customMapStyle={colorScheme === "dark" ? movoMapStyleDark : movoMapStyleLight}
              style={{ flex: 1 }}
              initialRegion={
                draftLat !== null && draftLng !== null
                  ? { latitude: draftLat, longitude: draftLng, latitudeDelta: 0.01, longitudeDelta: 0.01 }
                  : FALLBACK_REGION
              }
            >
              {draftLat !== null && draftLng !== null ? (
                <Marker
                  testID={testID ? `${testID}-marker` : undefined}
                  coordinate={{ latitude: draftLat, longitude: draftLng }}
                  draggable
                  anchor={{ x: 0.5, y: 1 }}
                  onDragEnd={(e) => {
                    setDraftLat(e.nativeEvent.coordinate.latitude);
                    setDraftLng(e.nativeEvent.coordinate.longitude);
                  }}
                >
                  <View
                    style={{
                      paddingTop: 12,
                      paddingHorizontal: 12,
                      shadowColor: "#000",
                      shadowOffset: { width: 0, height: 2 },
                      shadowOpacity: 0.3,
                      shadowRadius: 3,
                      elevation: 4,
                    }}
                  >
                    <MapPin size={44} strokeWidth={1.5} color="#1A1A1D" fill="#C6F24A" />
                  </View>
                </Marker>
              ) : null}
            </MapView>
            <Pressable
              testID={testID ? `${testID}-confirm` : undefined}
              onPress={handleConfirm}
              disabled={draftLat === null || draftLng === null}
              className="absolute bottom-3 left-3 right-3 items-center rounded-lg bg-fg py-3"
            >
              <Text className="font-sans-semibold text-body text-white dark:text-ink-950">Confirmar ubicación</Text>
            </Pressable>
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
}
