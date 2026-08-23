import { useEffect, useState } from "react";
import { Dimensions } from "react-native";
import {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

const SCREEN_HEIGHT = Dimensions.get("window").height;
const OPEN_DURATION = 280;
const CLOSE_DURATION = 200;

/**
 * Reemplaza `animationType="slide"` de RN `Modal` en todos los sheets del pie de
 * pantalla (feedback de usuario: "el overlay sube pegado a la hoja, no es lo
 * estándar") — ese `animationType` anima TODO el contenido del `Modal` como una
 * sola pieza, así que el overlay oscuro se desliza desde abajo junto con la hoja en
 * vez de solo aparecer, que es el comportamiento de cualquier bottom sheet real
 * (iOS/Android/Material: el overlay hace fade, solo la hoja se desliza). Acá el
 * `Modal` en sí no anima nada (`animationType="none"`, se pasa `isMounted` como su
 * `visible`) y el fade del overlay / slide de la hoja se separan a mano, coordinados
 * por un único progreso compartido (0 cerrado, 1 abierto) para que abrir/cerrar se
 * sienta como una sola animación en vez de dos independientes desincronizadas.
 *
 * `isMounted` demora el desmontaje real hasta que termina la animación de cierre —
 * si el `Modal` se desmontara apenas `visible` (el que recibe el caller, no el que
 * devuelve el hook) pasa a `false`, la hoja desaparecería de un salto en vez de
 * deslizarse hacia abajo.
 *
 * El open se demora un frame con `requestAnimationFrame` (fix de feedback: la
 * primera versión arrancaba `withTiming` en el mismo efecto que monta el `Modal` —
 * montar el `Modal` nativo de RN no es instantáneo, así que en dispositivo real el
 * progreso ya iba adelantado para cuando el `Modal` terminaba de aparecer, y la
 * hoja se veía "saltar" a mitad de camino en vez de deslizarse fluida desde abajo).
 * El cierre no necesita ese mismo delay: arranca ya con el `Modal` montado.
 */
export function useSheetAnimation(visible: boolean) {
  const progress = useSharedValue(visible ? 1 : 0);
  const [isMounted, setIsMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setIsMounted(true);
      const raf = requestAnimationFrame(() => {
        progress.value = withTiming(1, {
          duration: OPEN_DURATION,
          easing: Easing.out(Easing.cubic),
        });
      });
      return () => cancelAnimationFrame(raf);
    }
    progress.value = withTiming(
      0,
      { duration: CLOSE_DURATION, easing: Easing.in(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(setIsMounted)(false);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * SCREEN_HEIGHT }],
  }));

  return { isMounted, backdropStyle, sheetStyle };
}
