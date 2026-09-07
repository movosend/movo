import * as Haptics from "expo-haptics";
import { ArrowRight } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

const THUMB_SIZE = 48;
// Padding real del track alrededor del thumb (`p-2` de Tailwind) -- con esto el
// thumb nunca toca el borde exterior, ni en reposo ni al final del recorrido.
const TRACK_PADDING = 8;
// Umbral de confirmación: no hace falta llegar al 100% del recorrido (rozar el borde
// derecho con precisión es incómodo), pero sí una porción clara del track -- por
// debajo de esto se interpreta como un roce accidental, no una intención de confirmar.
const CONFIRM_THRESHOLD = 0.7;

/**
 * Control "deslizá para confirmar" (reemplaza el botón simple de "Enviar oferta",
 * MOVO-177/feedback de diseño): una oferta es una transacción de plata real, un tap
 * accidental no debería poder dispararla. `Gesture.Pan()` en vez de `PanResponder`,
 * mismo criterio que `ZoomableImage` (`photo-viewer-modal.tsx`) -- ya es la API de
 * gestos que usa el repo.
 *
 * `rounded-lg` en track y thumb, no un radio distinto inventado para este control --
 * es el mismo que ya usan los botones primarios de esta pantalla ("Continuar"), para
 * que no se sienta como un componente ajeno al resto de la UI.
 *
 * El ancho del track se mide en runtime (`onLayout`, no hay forma de conocerlo antes
 * de montar) -- la `Gesture.Pan()` se recrea en cada render y cierra sobre el
 * `maxTranslate` del render actual, así que no hace falta un shared value aparte para
 * ese límite.
 */
export function SlideToConfirm({
  label,
  onConfirm,
  disabled,
  loading,
  testID,
}: {
  label: string;
  onConfirm: () => void;
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
}) {
  const [trackWidth, setTrackWidth] = useState(0);
  const translateX = useSharedValue(0);
  // Evita repetir el tick de umbral en cada frame mientras el dedo se queda del lado
  // confirmable del recorrido -- un solo golpecito al cruzarlo, no una vibración
  // continua.
  const hasTickedThreshold = useSharedValue(false);
  const maxTranslate = Math.max(trackWidth - THUMB_SIZE - TRACK_PADDING * 2, 0);

  // Funciones JS planas para `runOnJS` -- nunca se referencia el módulo `Haptics`
  // directo desde dentro de un worklet (mismo criterio que `reportZoom` en
  // `photo-viewer-modal.tsx`): un worklet solo puede cerrar sobre closures propias,
  // no sobre el namespace completo de un módulo importado.
  const handleThresholdTick = () => {
    Haptics.selectionAsync();
  };
  const handleConfirmImpact = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };
  const handleConfirm = () => {
    onConfirm();
  };

  const pan = Gesture.Pan()
    .enabled(!disabled && !loading)
    .onStart(() => {
      hasTickedThreshold.value = false;
    })
    .onUpdate((event) => {
      translateX.value = Math.min(
        Math.max(event.translationX, 0),
        maxTranslate,
      );
      if (
        maxTranslate > 0 &&
        translateX.value >= maxTranslate * CONFIRM_THRESHOLD &&
        !hasTickedThreshold.value
      ) {
        hasTickedThreshold.value = true;
        runOnJS(handleThresholdTick)();
      }
    })
    .onEnd(() => {
      if (maxTranslate > 0 && translateX.value >= maxTranslate * CONFIRM_THRESHOLD) {
        translateX.value = withTiming(maxTranslate, { duration: 150 });
        runOnJS(handleConfirmImpact)();
        runOnJS(handleConfirm)();
        return;
      }
      translateX.value = withTiming(0, { duration: 200 });
    });

  useEffect(() => {
    // Si el submit falla (vuelve a "form" con el mismo control montado) el thumb
    // tiene que volver al origen -- si no queda visualmente "confirmado" sin estarlo.
    if (!loading) translateX.value = withTiming(0, { duration: 200 });
  }, [loading, translateX]);

  const thumbStyle = useAnimatedStyle(() => ({
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    transform: [{ translateX: translateX.value }],
  }));
  // `opacity` en 0 hasta que el dedo se mueve de verdad (no solo un umbral chico —
  // en reposo exacto, `translateX.value === 0`): así, en reposo, no queda ningún
  // pixel de este relleno visible detrás del thumb pase lo que pase con el ancho
  // relativo de ambos -- el thumb (mismas dimensiones exactas, `THUMB_SIZE`) es lo
  // único que se ve hasta que arranca el gesto.
  const fillStyle = useAnimatedStyle(() => ({
    width: translateX.value + THUMB_SIZE,
    opacity: translateX.value > 0 ? 1 : 0,
  }));

  return (
    <View
      testID={testID}
      onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
      className={`h-16 justify-center overflow-hidden rounded-lg bg-fg p-2 ${
        disabled ? "opacity-50" : ""
      }`}
    >
      <Animated.View
        pointerEvents="none"
        style={fillStyle}
        className="absolute bottom-2 left-2 top-2 rounded-lg bg-lime-500/20"
      />
      <View pointerEvents="none" className="absolute inset-0 items-center justify-center">
        <Text className="font-sans-semibold text-body text-bg">{label}</Text>
      </View>
      <GestureDetector gesture={pan}>
        <Animated.View
          style={thumbStyle}
          className="items-center justify-center rounded-lg bg-lime-500"
        >
          {loading ? (
            <ActivityIndicator color="#0A0A0B" />
          ) : (
            <ArrowRight size={20} color="#0A0A0B" strokeWidth={2.5} />
          )}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
