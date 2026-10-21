import { useEffect } from "react";
import type { ViewProps } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

const PULSE_DURATION_MS = 700;

/** Bloque con la forma de un elemento en carga (perfil, MOVO-78 AC8; receptor/avatar,
 * MOVO-83; detalle de envío, MOVO-127) — un único lugar para el pulso animado
 * (opacidad 0.5↔1 en loop, Reanimated, ya dependencia del repo) en vez de una
 * librería de shimmer nueva: cualquier skeleton que use este bloque lo hereda gratis,
 * sin coordinar la animación pantalla por pantalla. Extraído originalmente de
 * `ProfileSkeleton` para no duplicar el mismo `<View className="bg-bg-mute" />` cada
 * vez que se necesita un placeholder. */
export function SkeletonBlock({ className, style, ...props }: ViewProps & { className?: string }) {
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(reduceMotion ? 0.75 : 0.5);

  useEffect(() => {
    // MOVO-168: con "reducir movimiento" el bloque queda quieto, a media opacidad.
    if (reduceMotion) {
      opacity.value = 0.75;
      return;
    }
    opacity.value = withRepeat(
      withTiming(1, { duration: PULSE_DURATION_MS, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [opacity, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return <Animated.View className={`bg-bg-mute ${className ?? ""}`} style={[animatedStyle, style]} {...props} />;
}
