/** `#RRGGBB` a `rgba(r,g,b,alpha)` — para animar opacidad sobre un color de tema que
 * solo viene como hex (`useThemeColors`), sin mantener una paleta rgba paralela.
 * Marcada `worklet` porque `RouteMapCard` la llama también desde un worklet de
 * Reanimated (UI thread) — sigue funcionando igual desde el JS thread.
 *
 * El alpha se acota a 0..1 y se redondea a 3 decimales: una opacidad animada que se acerca a 0 pasa por valores como
 * `8.5e-11`, que interpolados en el string quedaban en notación científica, y Reanimated tiraba "Invalid color value"
 * (mapa del envío). Sin un número válido, opaco. */
export function hexToRgba(hex: string, alpha: number): string {
  "worklet";
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const a = Number.isFinite(alpha) ? Math.round(Math.min(1, Math.max(0, alpha)) * 1000) / 1000 : 1;
  return `rgba(${r},${g},${b},${a})`;
}
