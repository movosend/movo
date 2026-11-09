/**
 * Normalización de nombres y apellidos de personas.
 *
 * El nombre legal de una cuenta lo trae el documento que lee Didit al aprobar el KYC de
 * identidad (`svc-users`), y el documento suele venir en mayúsculas ("MARÍA JOSÉ"). Esta
 * función lo deja como se escribe un nombre propio: cada palabra con inicial mayúscula y
 * el resto en minúscula, con las partículas ("de", "del", "la", ...) en minúscula salvo al
 * principio. Un único lugar para la regla: el mobile y los servicios la comparten.
 *
 * Se aplica por separado al nombre de pila y al apellido, así una partícula que abre un
 * apellido ("Del Valle") conserva su mayúscula.
 *
 * Fuera de alcance a propósito: prefijos tipo "Mc"/"Mac" ("McDonald") y cualquier otra
 * regla que dependa del origen del apellido. Salen como "Mcdonald".
 */

const PARTICLES: ReadonlySet<string> = new Set([
  "de",
  "del",
  "la",
  "las",
  "los",
  "y",
  "e",
  "da",
  "das",
  "do",
  "dos",
  "di",
  "van",
  "von",
  "der",
]);

const LOCALE = "es-AR";

/** Mayúscula inicial de cada tramo separado por guion o apóstrofe ("o'brien" -> "O'Brien"). */
function capitalizeSegments(word: string): string {
  return word
    .split(/(['’-])/)
    .map((part) =>
      part.length > 0 && !/^['’-]$/.test(part)
        ? part.charAt(0).toLocaleUpperCase(LOCALE) + part.slice(1)
        : part
    )
    .join("");
}

export function normalizePersonName(raw: string | null | undefined): string {
  const words = (raw ?? "")
    .trim()
    .toLocaleLowerCase(LOCALE)
    .split(/\s+/)
    .filter(Boolean);

  return words
    .map((word, index) => (index > 0 && PARTICLES.has(word) ? word : capitalizeSegments(word)))
    .join(" ");
}
