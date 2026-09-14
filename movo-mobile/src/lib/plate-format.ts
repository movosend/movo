/**
 * Formato y validación de patentes argentinas (MOVO-223) — dos formatos
 * vigentes: Mercosur (`AB123CD`, 2 letras + 3 números + 2 letras) y el
 * anterior (`ABC123`, 3 letras + 3 números). Puramente funciones puras, sin
 * estado — la pantalla decide cuándo mostrar error/hint/éxito.
 */

export type PlateFormat = "mercosur" | "old";

const PATTERNS: Record<PlateFormat, ("A" | "N")[]> = {
  mercosur: ["A", "A", "N", "N", "N", "A", "A"],
  old: ["A", "A", "A", "N", "N", "N"],
};

export function plateLength(format: PlateFormat): number {
  return PATTERNS[format].length;
}

/** Grupos de casilleros para el render visual (con separación entre grupos). */
export function plateGroups(format: PlateFormat): number[] {
  return format === "mercosur" ? [2, 3, 2] : [3, 3];
}

/**
 * Detecta el formato a partir de lo tipeado hasta ahora: la 3ra posición es un
 * número en Mercosur y una letra en el formato anterior. Con menos de 3
 * caracteres se mantiene el formato ya elegido (por el toggle o el default).
 */
export function detectFormat(value: string, current: PlateFormat): PlateFormat {
  if (value.length < 3) return current;
  return /[0-9]/.test(value[2]) ? "mercosur" : "old";
}

/**
 * Normaliza input crudo de usuario a mayúsculas alfanuméricas y aplica la
 * máscara del formato detectado, descartando caracteres que no matchean la
 * posición esperada (letra/número) en vez de solo truncar por longitud.
 */
export function maskPlateInput(raw: string, currentFormat: PlateFormat): { value: string; format: PlateFormat } {
  let value = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const format = detectFormat(value, currentFormat);
  const pattern = PATTERNS[format];
  value = value
    .split("")
    .filter((ch, i) => {
      if (i >= pattern.length) return false;
      return pattern[i] === "A" ? /[A-Z]/.test(ch) : /[0-9]/.test(ch);
    })
    .join("")
    .slice(0, pattern.length);
  return { value, format };
}

export function isPlateValid(plate: string, format: PlateFormat): boolean {
  return format === "mercosur" ? /^[A-Z]{2}\d{3}[A-Z]{2}$/.test(plate) : /^[A-Z]{3}\d{3}$/.test(plate);
}

export function formatLabel(format: PlateFormat): string {
  return format === "mercosur" ? "Mercosur" : "anterior";
}

export function plateFormatErrorMessage(format: PlateFormat): string {
  return format === "mercosur"
    ? "Faltan caracteres. El formato Mercosur es 2 letras, 3 números, 2 letras."
    : "Faltan caracteres. El formato anterior es 3 letras y 3 números.";
}
