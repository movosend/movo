/**
 * Formateo puro de los datos del perfil (MOVO-78 AC10 — el criterio que "rompe la
 * demo" si se descuida: sin envíos/ratings todavía en este sprint, todos los usuarios
 * van a tener contadores en cero y sin score durante la Sprint Review, y la pantalla
 * tiene que verse bien en ese estado exacto).
 *
 * Cada función trata `null`/`undefined`/`NaN` como "sin dato" con un guard clause
 * explícito al inicio — nunca un `?? 0` ciego, que dejaría pasar `NaN` (`NaN ?? 0` es
 * `NaN`, no `0`) y lo renderizaría tal cual.
 */

function isMissing(value: number | null | undefined): boolean {
  return value === null || value === undefined || Number.isNaN(value);
}

export function formatShipmentCount(count: number | null | undefined): string {
  if (isMissing(count) || count === 0) return "Sin envíos aún";
  return count === 1 ? "1 envío" : `${count} envíos`;
}

export function formatTripCount(count: number | null | undefined): string {
  if (isMissing(count) || count === 0) return "Sin viajes aún";
  return count === 1 ? "1 viaje" : `${count} viajes`;
}

/** Nunca "0 estrellas" — comunica algo distinto (y peor) que "todavía no hay
 * calificaciones". */
export function formatReputationScore(score: number | null | undefined): string {
  if (score === null || score === undefined || Number.isNaN(score)) return "Sin calificaciones";
  return score.toFixed(1);
}

/** Iniciales para el fallback del avatar — "?" si no hay nombre real. */
export function getInitials(fullName: string | null | undefined): string {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]!.charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1]!.charAt(0) : "";
  return (first + last).toUpperCase();
}

/**
 * Formatea un teléfono E.164 argentino (`+549...`, ver `normalizePhoneToE164Ar` en
 * `svc-users`) a un formato legible, con el "9" de celular visible como grupo propio:
 * Buenos Aires (área de 2 dígitos, abonado de 8) → `+54 9 11 4023-8871`; resto del país
 * (área de 3 dígitos, abonado de 7, split 3-4) → `+54 9 351 123-4567`. Mismo criterio de
 * largo de código de área que `formatPhone` de `use-registration.tsx` — no se comparte
 * el helper porque ese vive del lado del input local de 10 dígitos, no de un E.164
 * completo.
 *
 * Si el valor no matchea el patrón esperado (largo/prefijo no reconocidos), se
 * devuelve tal cual en vez de arriesgar un formateo incorrecto.
 */
export function formatPhoneDisplay(phone: string | null | undefined): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  const local = digits.startsWith("549")
    ? digits.slice(3)
    : digits.startsWith("54")
      ? digits.slice(2)
      : digits;
  if (local.length !== 10) return phone;

  const isBsAs = local.slice(0, 2) === "11";
  const areaCode = isBsAs ? local.slice(0, 2) : local.slice(0, 3);
  const subscriber = isBsAs ? local.slice(2) : local.slice(3);
  const splitAt = isBsAs ? 4 : 3;
  return `+54 9 ${areaCode} ${subscriber.slice(0, splitAt)}-${subscriber.slice(splitAt)}`;
}
