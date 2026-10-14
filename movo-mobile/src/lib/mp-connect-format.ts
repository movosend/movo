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

/** Largo máximo de la parte local del email antes de recortarla. */
const EMAIL_LOCAL_MAX = 14;

/**
 * Acorta la parte antes de la `@` y conserva el dominio completo: los emails de MP (sobre
 * todo los de las cuentas de prueba, `test_user_7133831507754225491@testuser.com`) no entran
 * en la fila y cortarlos al final escondía de qué cuenta se trata.
 * "test_user_7133831507754225491@testuser.com" → "test_user_7133…@testuser.com".
 */
export function shortenEmail(email: string, maxLocal: number = EMAIL_LOCAL_MAX): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return email.length > maxLocal ? `${email.slice(0, maxLocal)}…` : email;
  const local = email.slice(0, at);
  if (local.length <= maxLocal) return email;
  return `${local.slice(0, maxLocal)}…${email.slice(at)}`;
}
