import { ApiError, CarrierRequirementsErrorDetails } from "@movo/shared";
import { PaymentsClient } from "../adapters/payments-client";

/**
 * MOVO-37: gates de un envío pagado en efectivo. Sin hold, la comisión de Movo y las penalidades se cobran por la
 * cuenta corriente (DD-044), así que la deuda se mira antes de comprometerse. Consultan el saldo en
 * `svc-payments` en cada llamada (sin cache, igual que MOVO-313: saldar levanta el bloqueo en la siguiente) y fallan
 * cerrado: si payments no responde, propagan su 502 `PAYMENTS_SERVICE_UNAVAILABLE`.
 */

/**
 * Emisor: con cualquier deuda en la cuenta corriente (`balanceArs > 0`, vencida o no) no puede crear ni pasar un
 * envío a efectivo. Con tarjeta sí puede, porque su próximo pago ya la cobra (MOVO-311); un emisor que solo opera en
 * efectivo nunca la saldaría. Excepción acotada a "como emisor no se bloquea" de MOVO-313: no se le bloquea operar,
 * solo la modalidad. 403 `CASH_PAYMENT_SENDER_HAS_DEBT` con `no_pending_debt` en `details.missingRequirements`.
 */
export async function assertSenderCanPayCash(paymentsClient: PaymentsClient, senderId: string): Promise<void> {
  const debt = await paymentsClient.getUserDebtStatus(senderId);
  if (debt.balanceArs > 0) {
    const details: CarrierRequirementsErrorDetails = { missingRequirements: ["no_pending_debt"] };
    throw new ApiError(
      403,
      "CASH_PAYMENT_SENDER_HAS_DEBT",
      "Tenés un saldo pendiente con Movo: para pagar en efectivo primero tenés que saldarlo. Con tarjeta podés seguir enviando.",
      { ...details }
    );
  }
}

/** `true` si la deuda total (vencida o no) del transportista supera el tope para envíos en efectivo. */
export function exceedsCashDebtLimit(debtBalanceArs: number, maxDebtArs: number): boolean {
  return debtBalanceArs > maxDebtArs;
}

/** El tope `CASH_SHIPMENT_MAX_CARRIER_DEBT_ARS` que inyecta cada servicio: sin valor lanza, no se saltea el chequeo. */
export function requireCashDebtLimit(maxDebtArs: number | undefined, owner: string): number {
  if (maxDebtArs === undefined) {
    throw new Error(`Un envío en efectivo requiere cashShipmentMaxCarrierDebtArs (${owner}).`);
  }
  return maxDebtArs;
}

/**
 * Transportista (B4): con una deuda total (vencida o no) por encima de `CASH_SHIPMENT_MAX_CARRIER_DEBT_ARS` no puede
 * ofertar ni editar una oferta en un envío en efectivo, donde cada entrega le suma la comisión como deuda.
 * Complementa al bloqueo por antigüedad de MOVO-313: este frena el acumulado antes de que venza. Recibe el saldo que
 * ya trajo `assertCarrierCanOperate` (`debtBalanceArs`): una sola lectura por operación, así los dos chequeos no
 * pueden discrepar. 403 `CASH_DEBT_LIMIT_EXCEEDED` con `cash_debt_within_limit` en `details.missingRequirements`,
 * para que la app lo muestre como un requisito pendiente (MOVO-117).
 */
export function assertCarrierWithinCashDebtLimit(debtBalanceArs: number, maxDebtArs: number): void {
  if (exceedsCashDebtLimit(debtBalanceArs, maxDebtArs)) {
    const details: CarrierRequirementsErrorDetails = { missingRequirements: ["cash_debt_within_limit"] };
    throw new ApiError(
      403,
      "CASH_DEBT_LIMIT_EXCEEDED",
      "Tu saldo pendiente con Movo superó el tope para llevar envíos en efectivo. Saldalo para volver a ofertar en ellos; en los envíos con tarjeta podés seguir operando.",
      { ...details }
    );
  }
}
