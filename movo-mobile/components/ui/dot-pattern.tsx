import { useWindowDimensions } from 'react-native';
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Mask,
  Pattern,
  Rect,
  Stop,
} from 'react-native-svg';

const DOT_SIZE = 16;
const DOT_RADIUS = 1.3;
const DOT_COLOR = '#C6F24A'; // lime-500
const DOT_OPACITY = 0.85;

type DotPatternProps = {
  /** Alto del patrón, en proporción al alto de pantalla (0-1). */
  heightRatio?: number;
};

/**
 * Halftone decorativo del manual de marca: grilla de puntos lime, pareja en
 * todo el ancho, que se desvanece verticalmente hacia abajo. Pensado como
 * fondo del header de las pantallas del flujo de registro — se renderiza
 * detrás del contenido (`pointerEvents="none"`), nunca lo intercepta.
 */
export function DotPattern({ heightRatio = 0.42 }: DotPatternProps) {
  const { width, height: screenHeight } = useWindowDimensions();
  const height = screenHeight * heightRatio;

  return (
    <Svg
      width={width}
      height={height}
      pointerEvents="none"
      style={{ position: 'absolute', top: 0, left: 0 }}
    >
      <Defs>
        <Pattern
          id="dot-pattern-grid"
          patternUnits="userSpaceOnUse"
          width={DOT_SIZE}
          height={DOT_SIZE}
        >
          <Circle
            cx={DOT_SIZE / 2}
            cy={DOT_SIZE / 2}
            r={DOT_RADIUS}
            fill={DOT_COLOR}
            opacity={DOT_OPACITY}
          />
        </Pattern>
        <LinearGradient id="dot-pattern-fade" x1="0%" y1="0%" x2="0%" y2="100%">
          <Stop offset="0%" stopColor="#FFFFFF" stopOpacity={1} />
          <Stop offset="70%" stopColor="#FFFFFF" stopOpacity={1} />
          <Stop offset="100%" stopColor="#FFFFFF" stopOpacity={0} />
        </LinearGradient>
        <Mask id="dot-pattern-mask">
          <Rect width="100%" height="100%" fill="url(#dot-pattern-fade)" />
        </Mask>
      </Defs>
      <Rect
        width="100%"
        height="100%"
        fill="url(#dot-pattern-grid)"
        mask="url(#dot-pattern-mask)"
      />
    </Svg>
  );
}
