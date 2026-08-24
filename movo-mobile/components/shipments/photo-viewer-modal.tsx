import { X } from "lucide-react-native";
import { useState } from "react";
import {
  Image,
  Modal,
  Pressable,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { FlatList, Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { SafeAreaProvider, SafeAreaView, initialWindowMetrics } from "react-native-safe-area-context";
import type { ShipmentPhoto } from "../../src/api/shipments-client";

// Mismo fallback que `AddressSearchSheet` — `initialWindowMetrics` es `null` en Jest
// (sin módulo nativo real), no bloquea el primer render en device.
const FALLBACK_METRICS = {
  frame: { x: 0, y: 0, width: 0, height: 0 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;

interface ZoomableImageProps {
  uri: string;
  width: number;
  onZoomChange: (zoomed: boolean) => void;
  testID?: string;
}

/**
 * Pinch-to-zoom + pan + doble tap (feedback post-QA: se pedía poder acercar la foto).
 * `react-native-gesture-handler`/`react-native-reanimated` ya eran dependencias del
 * repo (`RouteMapCard` ya usa reanimated) pero ningún componente usaba la API de
 * gestos todavía — primer uso, requiere `GestureHandlerRootView` en la raíz
 * (`app/_layout.tsx`). `onZoomChange` avisa al visor para desactivar el swipe entre
 * fotos del `FlatList` mientras esta imagen está agrandada — sin esto, arrastrar
 * dentro de una foto zoomeada competiría con el paginado horizontal.
 */
function ZoomableImage({ uri, width, onZoomChange, testID }: ZoomableImageProps) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  // Espejo en JS del zoom (además de los shared values de arriba, que solo se leen
  // en worklets) — gatea `pan.enabled()` abajo. Sin esto el gesto de un solo dedo de
  // `Gesture.Pan()` queda activo todo el tiempo y le gana la garra al scroll nativo
  // del `FlatList` de swipe entre fotos, incluso con `savedScale === 1` (el early
  // `return` de adentro solo evitaba mover la imagen, no evitaba que el gesto
  // "reclamara" el touch) — el swipe entre fotos no andaba nunca, con o sin zoom.
  const [isZoomed, setIsZoomed] = useState(false);

  const resetZoom = () => {
    "worklet";
    scale.value = withTiming(1);
    translateX.value = withTiming(0);
    translateY.value = withTiming(0);
    savedScale.value = 1;
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
  };

  const reportZoom = (zoomed: boolean) => {
    setIsZoomed(zoomed);
    onZoomChange(zoomed);
  };

  const pinch = Gesture.Pinch()
    .onUpdate((event) => {
      scale.value = Math.min(Math.max(savedScale.value * event.scale, MIN_SCALE), MAX_SCALE);
    })
    .onEnd(() => {
      if (scale.value <= 1) {
        resetZoom();
      } else {
        savedScale.value = scale.value;
      }
      runOnJS(reportZoom)(savedScale.value > 1);
    });

  const pan = Gesture.Pan()
    .enabled(isZoomed)
    .onUpdate((event) => {
      translateX.value = savedTranslateX.value + event.translationX;
      translateY.value = savedTranslateY.value + event.translationY;
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (savedScale.value > 1) {
        resetZoom();
        runOnJS(reportZoom)(false);
      } else {
        scale.value = withTiming(DOUBLE_TAP_SCALE);
        savedScale.value = DOUBLE_TAP_SCALE;
        runOnJS(reportZoom)(true);
      }
    });

  const composed = Gesture.Race(doubleTap, Gesture.Simultaneous(pinch, pan));

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }, { scale: scale.value }],
  }));

  return (
    <View style={{ width, flex: 1, overflow: "hidden" }}>
      <GestureDetector gesture={composed}>
        <Animated.View
          testID={testID}
          style={[{ flex: 1, alignItems: "center", justifyContent: "center" }, animatedStyle]}
        >
          <Image source={{ uri }} style={{ width, height: "100%" }} resizeMode="contain" />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

export interface PhotoViewerModalProps {
  photos: ShipmentPhoto[];
  initialIndex: number;
  visible: boolean;
  onClose: () => void;
  testID?: string;
}

/**
 * Visor de fotos de evidencia del paquete a pantalla completa (AC4 de MOVO-127,
 * feedback post-QA: las fotos adjuntas eran solo un conteo en texto, sin forma de
 * verlas). Swipe horizontal paginado entre las fotos del envío, arranca en la que se
 * tocó desde la tira de miniaturas de `PackageCard` (`initialScrollIndex` +
 * `getItemLayout`, evita el salto/flash que da animar el scroll después del primer
 * render). El `FlatList` usado acá es el de `react-native-gesture-handler` (no el de
 * `react-native`) — necesario para que su scroll conviva con los gestos de pinch/pan
 * de `ZoomableImage` sin pelearse por el mismo puntero. La imagen ocupa todo el alto
 * disponible vía `flex: 1` en vez de un cálculo manual contra `Dimensions` (el cálculo
 * anterior restaba un alto de header fijo que no coincidía con el real, dejando la
 * foto descentrada verticalmente). Mismo patrón de `Modal` nativo que
 * `AddressSearchSheet`/`select-field` — no una ruta nueva de expo-router, el repo no
 * usa presentación modal de router en ningún otro lado todavía.
 */
export function PhotoViewerModal({ photos, initialIndex, visible, onClose, testID }: PhotoViewerModalProps) {
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(initialIndex);
  const [scrollEnabled, setScrollEnabled] = useState(true);

  const handleMomentumScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setIndex(Math.round(event.nativeEvent.contentOffset.x / width));
  };

  if (photos.length === 0) return null;

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose} testID={testID}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics ?? FALLBACK_METRICS}>
        <SafeAreaView className="flex-1 bg-ink-950" edges={["top", "bottom"]}>
          <View className="flex-row items-center justify-between px-4 pb-2 pt-1">
            <Pressable
              testID={testID ? `${testID}-close` : undefined}
              onPress={onClose}
              hitSlop={8}
              className="h-9 w-9 items-center justify-center rounded-full bg-white/10"
            >
              <X size={18} color="#FFFFFF" strokeWidth={2} />
            </Pressable>
            <Text className="font-sans-medium text-[13px] text-white/70">
              {index + 1} / {photos.length}
            </Text>
            <View className="h-9 w-9" />
          </View>

          <FlatList
            testID={testID ? `${testID}-list` : undefined}
            style={{ flex: 1 }}
            data={photos}
            keyExtractor={(photo) => photo.id}
            horizontal
            pagingEnabled
            scrollEnabled={scrollEnabled}
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={initialIndex}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            onMomentumScrollEnd={handleMomentumScrollEnd}
            renderItem={({ item, index: itemIndex }) => (
              <ZoomableImage
                testID={testID ? `${testID}-image-${itemIndex}` : undefined}
                uri={item.url}
                width={width}
                onZoomChange={(zoomed) => setScrollEnabled(!zoomed)}
              />
            )}
          />
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}
