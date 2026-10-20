import { useEffect } from "react";
import { StyleSheet, useWindowDimensions } from "react-native";
import Animated, { Easing, useAnimatedProps, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import Svg, { Defs, Mask, Rect } from "react-native-svg";

const AnimatedRect = Animated.createAnimatedComponent(Rect);

export interface SpotlightHole {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
}

const SCRIM_COLOR = "#050506";
const SCRIM_OPACITY = 0.78;
const RING_COLOR = "#C6F24A";
const RING_WIDTH = 2;
const TIMING = { duration: 320, easing: Easing.bezier(0.2, 0.8, 0.2, 1) };

/**
 * Oscurece la pantalla y recorta el ancla del paso (MOVO-169, AC1), con el anillo lime del
 * prototipo. Sin `hole` (pasos modales) el recorte se cierra en el centro. Recorte con
 * `Mask` y no `clipPath`: react-native-svg no aplica `clipPath` de forma confiable
 * (ver `components/ui/grid-pattern.tsx`). No recibe toques: los traga el overlay.
 */
export function TourSpotlight({ hole }: { hole: SpotlightHole | null }) {
  const { width, height } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const target = hole ?? { x: width / 2, y: height / 2, width: 0, height: 0, radius: 0 };

  const x = useSharedValue(target.x);
  const y = useSharedValue(target.y);
  const w = useSharedValue(target.width);
  const h = useSharedValue(target.height);
  const r = useSharedValue(target.radius);
  const ring = useSharedValue(hole ? 1 : 0);

  useEffect(() => {
    const animate = (value: { value: number }, to: number) => {
      value.value = reduceMotion ? to : withTiming(to, TIMING);
    };
    animate(x, target.x);
    animate(y, target.y);
    animate(w, target.width);
    animate(h, target.height);
    animate(r, target.radius);
    animate(ring, hole ? 1 : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.x, target.y, target.width, target.height, target.radius, reduceMotion]);

  const holeProps = useAnimatedProps(() => ({
    x: x.value,
    y: y.value,
    width: w.value,
    height: h.value,
    rx: r.value,
    ry: r.value,
  }));
  // El anillo va por fuera del recorte, como el `box-shadow` de 2px del prototipo.
  const ringProps = useAnimatedProps(() => ({
    x: x.value - RING_WIDTH / 2,
    y: y.value - RING_WIDTH / 2,
    width: w.value + RING_WIDTH,
    height: h.value + RING_WIDTH,
    rx: r.value + RING_WIDTH / 2,
    ry: r.value + RING_WIDTH / 2,
    strokeOpacity: ring.value,
  }));

  return (
    <Svg testID="tour-spotlight" width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <Mask id="tour-spotlight-mask" x={0} y={0} width={width} height={height} maskUnits="userSpaceOnUse">
          <Rect x={0} y={0} width={width} height={height} fill="#FFFFFF" />
          <AnimatedRect animatedProps={holeProps} fill="#000000" />
        </Mask>
      </Defs>
      <Rect
        x={0}
        y={0}
        width={width}
        height={height}
        fill={SCRIM_COLOR}
        fillOpacity={SCRIM_OPACITY}
        mask="url(#tour-spotlight-mask)"
      />
      <AnimatedRect animatedProps={ringProps} fill="none" stroke={RING_COLOR} strokeWidth={RING_WIDTH} />
    </Svg>
  );
}
