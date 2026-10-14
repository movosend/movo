import { StyleSheet } from "react-native";
import Svg, { Circle, Defs, Pattern, Rect } from "react-native-svg";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

const GRID = 14;

/**
 * Fondo de puntos de la conversación (prototipo: `radial-gradient(dot 1px, transparent 1.4px)` cada
 * 14 px, con `rgba(10,10,11,.07)` en claro y `rgba(255,255,255,.07)` en oscuro). El color sale del
 * tema: el `fg` de cada modo con la misma opacidad del prototipo.
 */
export function ChatDotBackground() {
  const colors = useThemeColors();
  return (
    <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width="100%" height="100%">
      <Defs>
        <Pattern id="chat-dots" patternUnits="userSpaceOnUse" width={GRID} height={GRID}>
          <Circle cx={GRID / 2} cy={GRID / 2} r={1} fill={colors.fg1} fillOpacity={0.07} />
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#chat-dots)" />
    </Svg>
  );
}
