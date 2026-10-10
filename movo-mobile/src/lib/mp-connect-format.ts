const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/**
 * "12 sep", como el mockup de MOVO-112. Meses a mano en vez de `Intl`: Hermes devuelve
 * "sept." o "sep." según la versión. Agrega el año solo si no es el actual. Día en hora
 * local: es "cuándo vinculé", no una fecha de calendario del backend.
 */
export function formatMpConnectedAt(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const label = `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`;
  return date.getFullYear() === now.getFullYear() ? label : `${label} ${date.getFullYear()}`;
}
