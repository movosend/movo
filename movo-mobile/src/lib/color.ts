/** `#RRGGBB` a `rgba(r,g,b,alpha)` — para animar opacidad sobre un color de tema que
 * solo viene como hex (`useThemeColors`), sin mantener una paleta rgba paralela.
 * Marcada `worklet` porque `RouteMapCard` la llama también desde un worklet de
 * Reanimated (UI thread) — sigue funcionando igual desde el JS thread. */
export function hexToRgba(hex: string, alpha: number): string {
  "worklet";
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
