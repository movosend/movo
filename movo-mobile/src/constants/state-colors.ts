/**
 * Hex de los tokens de estado de `tailwind.config.js`, para los lugares donde hace falta el
 * valor en JS y no una className (prop `color` de los íconos SVG). Mantener en sync con la
 * paleta semántica del config.
 */
export const STATE_COLORS = {
  success700: "#16754A",
  warning700: "#A97714",
} as const;
