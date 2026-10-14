/**
 * Validación y formato del DNI argentino, en un módulo propio y sin dependencias.
 *
 * Vivían dentro de `use-registration.tsx` (el módulo del `Context` del wizard de registro);
 * se extrajeron para que el alta de tarjeta (`card-form.ts`, MOVO-101) los reuse sin arrastrar
 * ese contexto, igual que `password-policy.ts` con `isPasswordValid` (MOVO-136).
 * `use-registration.tsx` los re-exporta, así que sus callers no cambian.
 */
export function isDniValid(v: string): boolean {
  const d = v.replace(/\D/g, "");
  return d.length >= 7 && d.length <= 8;
}

/** "36789012" → "36.789.012" (solo dígitos, hasta 8). */
export function formatDni(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 8);
  return d.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
