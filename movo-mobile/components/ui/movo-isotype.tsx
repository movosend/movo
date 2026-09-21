import React from "react";
import Svg, { Rect, Circle } from "react-native-svg";

export interface MovoIsotypeProps {
  size?: number;
  variant?: "dark" | "inverted";
  borderRadius?: number;
  testID?: string;
}

/**
 * Isotipo oficial de Movo según el Manual de Marca (#movo-logo-dark / #movo-logo-inverted).
 * viewBox original de 500x500 con los 5 círculos concéntricos que forman la apertura de la marca.
 */
export function MovoIsotype({
  size = 28,
  variant = "dark",
  borderRadius,
  testID = "movo-isotype",
}: MovoIsotypeProps) {
  const isDarkVariant = variant === "dark";
  const bgColor = isDarkVariant ? "#0A0A0B" : "#FFFFFF";
  const ringsColor = isDarkVariant ? "#FFFFFF" : "#0A0A0B";
  const centerHoleColor = isDarkVariant ? "#0A0A0B" : "#FFFFFF";

  // Por defecto en el manual de marca tiene clip-path inset(0 round 100px) en base 500
  const rx = borderRadius !== undefined ? (borderRadius / size) * 500 : 100;

  return (
    <Svg
      testID={testID}
      width={size}
      height={size}
      viewBox="0 0 500 500"
      fill="none"
    >
      <Rect
        x="0"
        y="0"
        width="500"
        height="500"
        rx={rx}
        ry={rx}
        fill={bgColor}
      />
      <Circle
        cx="250"
        cy="250"
        r="175.9"
        fill={ringsColor}
        fillOpacity={0.5}
      />
      <Circle
        cx="250"
        cy="250"
        r="164.9"
        fill={ringsColor}
        fillOpacity={0.5}
      />
      <Circle
        cx="250"
        cy="250"
        r="151.7"
        fill={ringsColor}
        fillOpacity={0.6}
      />
      <Circle
        cx="250"
        cy="250"
        r="136.2"
        fill={ringsColor}
      />
      <Circle
        cx="250"
        cy="250"
        r="119.8"
        fill={centerHoleColor}
      />
    </Svg>
  );
}
