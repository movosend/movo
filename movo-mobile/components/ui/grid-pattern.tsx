import { useState } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import Svg, { Defs, Path, Pattern, Rect } from "react-native-svg";

const GRID_SIZE = 22;
const GRID_COLOR = "#0A0A0B";
const GRID_OPACITY = 0.08;

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
export function GridPattern() {
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
                stroke={GRID_COLOR}
                strokeWidth={1}
                fill="none"
                opacity={GRID_OPACITY}
              />
            </Pattern>
          </Defs>
          <Rect width={size.width} height={size.height} fill="url(#grid-pattern-cell)" />
        </Svg>
      ) : null}
    </View>
  );
}
