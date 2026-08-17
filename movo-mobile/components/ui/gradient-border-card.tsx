import { LinearGradient } from "expo-linear-gradient";
import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";

export interface GradientBorderCardProps {
  fillColors: readonly [string, string, ...string[]];
  borderColors: readonly [string, string, ...string[]];
  borderRadius: number;
  borderWidth?: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
  testID?: string;
}

/** Simula un borde "specular reflection" (más claro arriba-izquierda, se apaga hacia
 * abajo-derecha) envolviendo un `LinearGradient` de relleno dentro de otro que hace de
 * marco — RN no tiene border-image / border-gradient nativo, este es el approach
 * estándar para lograrlo con `expo-linear-gradient` solo. Extraído de
 * `profile-stats-row.tsx` (MOVO-78) para reusarlo en las cards de `components/home/`
 * (MOVO-83) — mismo lenguaje visual "chrome" en toda la app. */
export function GradientBorderCard({
  fillColors,
  borderColors,
  borderRadius,
  borderWidth = 1.5,
  style,
  children,
  testID,
}: GradientBorderCardProps) {
  return (
    <LinearGradient
      testID={testID}
      colors={borderColors}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[{ borderRadius, padding: borderWidth }, style]}
    >
      <LinearGradient
        colors={fillColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ flex: 1, borderRadius: borderRadius - borderWidth }}
      >
        {children}
      </LinearGradient>
    </LinearGradient>
  );
}
