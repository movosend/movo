import type { UserLedgerBalanceResponse } from "@movo/shared";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * MOVO-313 (ADR-044): ¿la deuda de la cuenta corriente está vencida?
 *
 * Umbral por **antigüedad**, sin monto mínimo (decisión del equipo, 15/10/2026): quien sigue
 * operando con tarjeta la salda sola con su próximo pago (MOVO-311); el bloqueo apunta a quien
 * no la salda por esa vía (efectivo, MOVO-37).
 *
 * - `balanceArs` <= 0 (sin deuda o saldo a favor): no hay nada vencido.
 * - `oldestUnpaidAt` es la fecha del cargo más viejo que compone la deuda actual; se mide contra
 *   `overdueDays` con `>` estricto: a los 14 días justos todavía no está vencida.
 * - Un saldo positivo SIN `oldestUnpaidAt` (solo pasa si el saldo lo compone un movimiento ya
 *   `settled` sin contrapartida: `svc-payments` solo fecha los cargos `pending`/`reserved`) se
 *   trata como vencido: se debe plata y no hay forma de probar que es reciente, así que no se puede
 *   operar como si no se debiera nada. Se levanta igual que cualquier deuda: al compensar el saldo.
 * - Una fecha ilegible en el dominio también falla cerrado (el adaptador ya la rechaza antes como
 *   respuesta inválida, `payments-client.ts`).
 */
export function isUserDebtOverdue(
  balance: Pick<UserLedgerBalanceResponse, "balanceArs" | "oldestUnpaidAt">,
  now: Date,
  overdueDays: number,
): boolean {
  if (!(balance.balanceArs > 0)) {
    return false;
  }
  if (balance.oldestUnpaidAt === null) {
    return true;
  }
  const oldestMs = Date.parse(balance.oldestUnpaidAt);
  if (Number.isNaN(oldestMs)) {
    return true;
  }
  return now.getTime() - oldestMs > overdueDays * DAY_MS;
}
