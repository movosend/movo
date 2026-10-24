/** Escapa los comodines de `LIKE` (`%`, `_`) y la barra, que es su escape por defecto. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}
