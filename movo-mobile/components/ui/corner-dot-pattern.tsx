import { useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Mask,
  Pattern,
  Rect,
  Stop,
} from "react-native-svg";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const GRID = 10;
const DOT_RADIUS = 1.4;
/** Opacidad de la grilla estática: sutil, el pulso es lo que se nota. */
const DOT_OPACITY = 0.4;
const PULSING_DOTS = 22;
/** Opacidad máxima de un punto en el pico del pulso (antes del fade diagonal). */
const PULSE_PEAK = 0.85;

/** Misma curva que las paradas del gradiente de abajo, para que los puntos pulsantes sigan el fade. */
function fadeAt(t: number) {
  return t < 0.5 ? 1 - (t / 0.5) * 0.55 : 0.45 * (1 - (t - 0.5) / 0.5);
}

type Pulse = {
  x: number;
  y: number;
  peak: number;
  duration: number;
  delay: number;
};

function PulsingDot({ x, y, peak, duration, delay }: Pulse) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withDelay(
      delay,
      withRepeat(
        withSequence(withTiming(1, { duration }), withTiming(0, { duration })),
        -1,
      ),
    );
  }, [progress, delay, duration]);
  const props = useAnimatedProps(() => ({
    fillOpacity: progress.value * peak,
  }));
  return (
    <AnimatedCircle
      cx={x}
      cy={y}
      r={DOT_RADIUS + 0.4}
      fill="#B4B4BC"
      animatedProps={props}
    />
  );
}

/**
 * Puntos grises para superficies siempre oscuras (la card del monto en el detalle de un pago):
 * grilla anclada a la esquina superior derecha y desvaneciéndose en diagonal hasta la inferior
 * izquierda con un puñado de puntos que pulsan al azar, así el texto no compite con el patrón. Va detrás del contenido
 * (`pointerEvents="none"`); el contenedor debe tener `overflow-hidden` para respetar el radio de
 * las esquinas. Se mide el contenedor para alinear la grilla al borde derecho y para que el fade
 * recorra la diagonal real (en unidades de bounding box se deformaría con la proporción de la card).
 */
export function CornerDotPattern() {
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  const reduceMotion = useReducedMotion();
  // Puntos al azar de la grilla (solo donde el fade todavía deja verlos), cada uno con su ritmo.
  const pulses = useMemo<Pulse[]>(() => {
    if (!size || reduceMotion) return [];
    const x0 = (size.width % GRID) + GRID / 2;
    const cols = Math.floor(size.width / GRID);
    const rows = Math.floor(size.height / GRID);
    const diag = size.width ** 2 + size.height ** 2;
    const out: Pulse[] = [];
    for (
      let attempt = 0;
      attempt < PULSING_DOTS * 6 && out.length < PULSING_DOTS;
      attempt++
    ) {
      const x = x0 + Math.floor(Math.random() * cols) * GRID;
      const y = GRID / 2 + Math.floor(Math.random() * rows) * GRID;
      const t = ((size.width - x) * size.width + y * size.height) / diag;
      const fade = fadeAt(t);
      if (fade < 0.15) continue;
      out.push({
        x,
        y,
        peak: PULSE_PEAK * fade,
        duration: 900 + Math.random() * 1300,
        delay: Math.random() * 2500,
      });
    }
    return out;
  }, [size, reduceMotion]);
  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      onLayout={(e) => setSize(e.nativeEvent.layout)}
    >
      {size ? (
        <Svg width={size.width} height={size.height}>
          <Defs>
            {/* x = resto del ancho: las columnas quedan alineadas al borde derecho, no al izquierdo. */}
            <Pattern
              id="corner-dots"
              patternUnits="userSpaceOnUse"
              x={size.width % GRID}
              y={0}
              width={GRID}
              height={GRID}
            >
              <Circle
                cx={GRID / 2}
                cy={GRID / 2}
                r={DOT_RADIUS}
                fill="#8E8E96"
                fillOpacity={DOT_OPACITY}
              />
            </Pattern>
            <LinearGradient
              id="corner-dots-fade"
              gradientUnits="userSpaceOnUse"
              x1={size.width}
              y1={0}
              x2={0}
              y2={size.height}
            >
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity={1} />
              <Stop offset="0.5" stopColor="#FFFFFF" stopOpacity={0.45} />
              <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
            </LinearGradient>
            <Mask id="corner-dots-mask">
              <Rect
                width={size.width}
                height={size.height}
                fill="url(#corner-dots-fade)"
              />
            </Mask>
          </Defs>
          <Rect
            width={size.width}
            height={size.height}
            fill="url(#corner-dots)"
            mask="url(#corner-dots-mask)"
          />
          {pulses.map((pulse) => (
            <PulsingDot key={`${pulse.x}-${pulse.y}`} {...pulse} />
          ))}
        </Svg>
      ) : null}
    </View>
  );
}
