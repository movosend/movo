/**
 * Política de contraseña de MOVO, en un módulo propio y sin dependencias.
 *
 * Espeja exactamente el `pattern` que valida el backend (`registerBody.password` de
 * `auth.schema.ts` y `changePasswordBody.newPassword` de `users.schema.ts`, MOVO-134:
 * mínimo 8 caracteres, al menos una letra y al menos un dígito) — si esto y el schema
 * se desincronizan, el cliente deja pasar contraseñas que el backend rechaza con un
 * `400 VALIDATION_FAILED` genérico.
 *
 * Vivía dentro de `use-registration.tsx` (MOVO-73), que es el módulo del `Context` de
 * todo el wizard de registro. Extraído acá en MOVO-136 para que la pantalla de cambio
 * de contraseña pueda reusar la misma política sin arrastrar ese contexto entero —
 * mismo criterio con el que MOVO-121 sacó `AddressSelection` del store del wizard de
 * envíos. `use-registration.tsx` lo re-exporta, así que sus callers no cambian.
 */
export function isPasswordValid(v: string): boolean {
  return v.length >= 8 && /[A-Za-z]/.test(v) && /\d/.test(v);
}
