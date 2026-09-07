import { useState } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import Svg, { Defs, Path, Pattern, Rect } from "react-native-svg";

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
export function GridPattern({ color = DEFAULT_GRID_COLOR, opacity = DEFAULT_GRID_OPACITY }: GridPatternProps = {}) {
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
            <Pattern id="grid-pattern-cell" patternUnits="userSpaceOnUse" width={GRID_SIZE} height={GRID_SIZE}>
              <Path
                d={`M ${GRID_SIZE} 0 L 0 0 0 ${GRID_SIZE}`}
                stroke={color}
                strokeWidth={1}
                fill="none"
                opacity={opacity}
              />
            </Pattern>
          </Defs>
          <Rect width={size.width} height={size.height} fill="url(#grid-pattern-cell)" />
        </Svg>
      ) : null}
    </View>
  );
}
