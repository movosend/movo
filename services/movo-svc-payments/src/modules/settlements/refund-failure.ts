import type { readMpError } from "../holds/hold.service";

type MpErrorInfo = ReturnType<typeof readMpError>;

/**
 * MOVO-336: qué hacer con un error de MP al pedir un reembolso.
 *
 * - `auth`: MP rechazó las credenciales del transportista (401/403). Solo se arregla si se re-vincula.
 * - `insufficient_balance`: el transportista no tiene saldo en MP para devolver. NO se reintenta contra MP: la
 *   deuda pasa a su cuenta corriente (AC4).
 * - `transient`: no sabemos si MP hizo el reembolso (red, timeout, 5xx, 408, 429, o un 409 de una request con la
 *   misma key todavía en curso). El intento queda `processing` y el reintento reusa la key de MP: nunca se da por
 *   `failed`, porque podría estar hecho y un segundo pedido devolvería la plata dos veces.
 * - `rejected`: cualquier otro 4xx, un rechazo del pedido que repetirlo no cambia.
 */
export type RefundErrorClass = "auth" | "insufficient_balance" | "transient" | "rejected";

/**
 * Códigos de causa de MP que significan "saldo insuficiente". PENDIENTE del Paso 0 de MOVO-336 (reembolsar con un
 * transportista sin saldo en el sandbox, `test/refund.sandbox.test.ts`, escenario D): hasta tener el código real se
 * reconoce por el mensaje, que es la única señal que la doc de MP no garantiza. Sumar acá lo que devuelva el sandbox.
 */
export const INSUFFICIENT_BALANCE_CAUSES = new Set<string>([]);

/**
 * Más estricto que "insufficient": un 403 `insufficient permissions` no es falta de saldo. Incluye las variantes en
 * español por si MP responde en el idioma de la cuenta (la de Argentina): el Paso 0 tiene que confirmar el texto real.
 */
const INSUFFICIENT_BALANCE_MESSAGE =
  /insufficient (funds|balance|money)|not enough (funds|balance|money)|(saldo|fondos|dinero) (insuficientes?|disponible)|sin (saldo|fondos)|no (tiene|tienes|tenés|cuenta con|cuentas con|hay) (saldo|fondos|dinero)/i;

export function classifyRefundError(info: MpErrorInfo): RefundErrorClass {
  if (info.status === 401 || info.status === 403) return "auth";
  if (
    info.causeCodes.some((code) => INSUFFICIENT_BALANCE_CAUSES.has(code)) ||
    INSUFFICIENT_BALANCE_MESSAGE.test(info.message)
  ) {
    return "insufficient_balance";
  }
  const status = info.status;
  if (status === undefined || status >= 500 || status === 408 || status === 409 || status === 429) return "transient";
  return "rejected";
}
