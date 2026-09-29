import { useState } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import Svg, { Defs, Mask, Path, Pattern, RadialGradient, Rect, Stop } from "react-native-svg";

const GRID_SIZE = 22;
const DEFAULT_GRID_COLOR = "#0A0A0B";
const DEFAULT_GRID_OPACITY = 0.08;

export interface GridPatternProps {
  /** Color de las líneas — default pensado para cards claras (`bg-bg-mute`/
   * `bg-lime-*`). Un card oscuro de chrome fijo (`#0A0A0B`, ver
   * `transport/[id].tsx`) necesita líneas claras para que se vean, mismo criterio que
   * el mockup original (`rgba(255,255,255,.06)` sobre fondo negro). */
  color?: string;
  opacity?: number;
  /** MOVO-256: desvanece la grilla desde la esquina superior derecha hacia afuera
   * (card de estado del reporte). Equivale al `mask-image: radial-gradient(circle at
   * 100% 0, #000, transparent 70%)` del mockup. Sin `fade`, la grilla es pareja. */
  fade?: "top-right";
  /** Lado de cada celda en px (default 22). El card de estado del reporte usa 24. */
  cellSize?: number;
}

/**
 * Grilla decorativa sutil (mockup de `PricePreviewCard`, MOVO-83) — mismo criterio de
 * "patrón vía SVG, nunca intercepta toques" que `DotPattern`, pero como grilla de
 * líneas en vez de puntos, y sin fade (pensada para un card chico, no un header de
 * pantalla completa). Requiere que el contenedor tenga `position: relative` (o sea el
 * primer hijo de uno con `overflow-hidden`) para quedar recortada a los bordes
 * redondeados del card.
 *
 * Mide el tamaño real del contenedor con `onLayout` y lo pasa como ancho/alto en
 * píxeles al `Svg` — `width="100%"`/`height="100%"` como props de `Svg` (en vez de
 * dimensiones numéricas) dejaba el patrón un poco corto contra el borde derecho/
 * inferior del card (react-native-svg no resuelve bien esos porcentajes ahí).
 */
export function GridPattern({
  color = DEFAULT_GRID_COLOR,
  opacity = DEFAULT_GRID_OPACITY,
  fade,
  cellSize = GRID_SIZE,
}: GridPatternProps = {}) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize({ width, height });
  };

  return (
    <View
      pointerEvents="none"
      onLayout={handleLayout}
      style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
    >
      {size.width > 0 && size.height > 0 ? (
        <Svg width={size.width} height={size.height}>
          <Defs>
            <Pattern id="grid-pattern-cell" patternUnits="userSpaceOnUse" width={cellSize} height={cellSize}>
              <Path
                d={`M ${cellSize} 0 L 0 0 0 ${cellSize}`}
                stroke={color}
                strokeWidth={1}
                fill="none"
                opacity={opacity}
              />
            </Pattern>
            {fade === "top-right" ? (
              <>
                {/* `circle` de CSS llega por default hasta la esquina más lejana: el
                    radio es la diagonal, y el 70% del mockup es el stop transparente. */}
                <RadialGradient
                  id="grid-pattern-fade"
                  cx={size.width}
                  cy={0}
                  r={Math.hypot(size.width, size.height) * 0.7}
                  gradientUnits="userSpaceOnUse"
                >
                  <Stop offset="0" stopColor="#FFFFFF" stopOpacity={1} />
                  <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
                </RadialGradient>
                <Mask id="grid-pattern-mask">
                  <Rect width={size.width} height={size.height} fill="url(#grid-pattern-fade)" />
                </Mask>
              </>
            ) : null}
          </Defs>
          <Rect
            width={size.width}
            height={size.height}
            fill="url(#grid-pattern-cell)"
            {...(fade ? { mask: "url(#grid-pattern-mask)" } : {})}
          />
        </Svg>
      ) : null}
    </View>
  );
}
