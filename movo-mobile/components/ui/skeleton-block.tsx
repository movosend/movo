import { useEffect } from "react";
import type { ViewProps } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";

const PULSE_DURATION_MS = 700;

/** Bloque con la forma de un elemento en carga (perfil, MOVO-78 AC8; receptor/avatar,
 * MOVO-83; detalle de envío, MOVO-127) — un único lugar para el pulso animado
 * (opacidad 0.5↔1 en loop, Reanimated, ya dependencia del repo) en vez de una
 * librería de shimmer nueva: cualquier skeleton que use este bloque lo hereda gratis,
 * sin coordinar la animación pantalla por pantalla. Extraído originalmente de
 * `ProfileSkeleton` para no duplicar el mismo `<View className="bg-bg-mute" />` cada
 * vez que se necesita un placeholder. */
export function SkeletonBlock({ className, style, ...props }: ViewProps & { className?: string }) {
  const opacity = useSharedValue(0.5);

  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(1, { duration: PULSE_DURATION_MS, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return <Animated.View className={`bg-bg-mute ${className ?? ""}`} style={[animatedStyle, style]} {...props} />;
}
