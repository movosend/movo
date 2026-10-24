export interface Coordinates {
  lat: number;
  long: number;
}

const DECIMAL = String.raw`[+-]?\d{1,3}(?:\.\d+)?`;
const DECIMAL_PAIR = new RegExp(String.raw`^(${DECIMAL})\s*(?:,\s*|\s+)(${DECIMAL})$`);

// Un eje en grados/minutos/segundos con hemisferio, como lo copia Google Maps:
// `31°25'12.4"S`. Acepta las comillas tipográficas (′ ″) y `''` en lugar de `"`, y los
// segundos son opcionales. `O` (oeste) además de `W`, por si viene de una UI en español.
const DMS_AXIS = String.raw`(\d{1,3})\s*°\s*(\d{1,2})\s*['′]\s*(?:(\d{1,2}(?:\.\d+)?)\s*(?:"|″|''))?\s*([NSEWO])`;
const DMS_PAIR = new RegExp(String.raw`^${DMS_AXIS}\s*,?\s*${DMS_AXIS}$`, "i");

const COORDINATE_DECIMALS = 6;

/**
 * Interpreta un texto de búsqueda como coordenadas (MOVO-340), o devuelve `null` para
 * que siga el camino normal del autocompletado. Formatos: decimal con coma o espacio
 * entre latitud y longitud (`-31.4201, -64.1888`, `-31.4201 -64.1888`) y grados,
 * minutos y segundos (`31°25'12.4"S 64°11'19.7"W`). Fuera de rango (latitud ±90,
 * longitud ±180) tampoco es una coordenada.
 */
export function parseCoordinates(input: string): Coordinates | null {
  const text = input.trim();

  const decimal = DECIMAL_PAIR.exec(text);
  if (decimal) return inRange(Number(decimal[1]), Number(decimal[2]));

  const dms = DMS_PAIR.exec(text);
  if (dms) {
    const first = dmsAxis(dms[1]!, dms[2]!, dms[3], dms[4]!);
    const second = dmsAxis(dms[5]!, dms[6]!, dms[7], dms[8]!);
    if (!first || !second || first.isLatitude === second.isLatitude) return null;
    const [latAxis, longAxis] = first.isLatitude ? [first, second] : [second, first];
    return inRange(latAxis.value, longAxis.value);
  }

  return null;
}

/** Texto que se muestra cuando unas coordenadas no tienen dirección (`-31.4201, -64.1888`). */
export function formatCoordinates({ lat, long }: Coordinates): string {
  return `${lat}, ${long}`;
}

function dmsAxis(
  degrees: string,
  minutes: string,
  seconds: string | undefined,
  hemisphere: string
): { value: number; isLatitude: boolean } | null {
  const min = Number(minutes);
  const sec = seconds === undefined ? 0 : Number(seconds);
  if (min >= 60 || sec >= 60) return null;
  const letter = hemisphere.toUpperCase();
  const sign = letter === "S" || letter === "W" || letter === "O" ? -1 : 1;
  return {
    value: sign * (Number(degrees) + min / 60 + sec / 3600),
    isLatitude: letter === "N" || letter === "S",
  };
}

function inRange(lat: number, long: number): Coordinates | null {
  if (!Number.isFinite(lat) || !Number.isFinite(long)) return null;
  if (Math.abs(lat) > 90 || Math.abs(long) > 180) return null;
  return { lat: round(lat), long: round(long) };
}

function round(value: number): number {
  const factor = 10 ** COORDINATE_DECIMALS;
  // `+ 0` normaliza `-0` (p. ej. `-0.0000001`) para que la etiqueta no muestre "-0".
  return Math.round(value * factor) / factor + 0;
}
