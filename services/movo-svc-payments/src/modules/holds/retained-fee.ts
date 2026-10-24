import { Prisma } from "../../generated/prisma/client";
import type { Hold } from "../../repositories/hold-repository";

const { Decimal } = Prisma;
type Decimal = Prisma.Decimal;

export interface RetainedFeeSplit {
  /** Comisión de Movo. */
  commissionArs: Decimal;
  /** Deuda del transportista cobrada. */
  debtOffsetArs: Decimal;
  /** Deuda del emisor saldada (el recargo completo, aunque el fee lleve menos por la comisión de MP). */
  debtSurchargeArs: Decimal;
  /** La parte del fee retenido que corresponde al recargo (lo que entró al fee por él). */
  debtSurchargeFeeArs: Decimal;
}

/**
 * MOVO-311: reparte el `application_fee` que retuvo MP entre la comisión de Movo y la deuda que cobraba el
 * hold. Lo normal es que MP retenga exactamente lo pedido (la captura va sin `amount`); si retuvo menos, el
 * faltante se descuenta primero del recargo del emisor y después del descuento al transportista (la
 * comisión es lo último que se resigna), y la deuda saldada es la proporción efectivamente cobrada.
 */
export function splitRetainedFee(
  hold: Pick<Hold, "applicationFeeArs" | "commissionArs" | "debtOffsetArs" | "debtSurchargeArs">,
  retainedArs: Decimal
): RetainedFeeSplit {
  const commission = Decimal.min(hold.commissionArs, retainedArs);
  let debtRetained = Decimal.max(0, retainedArs.minus(commission));
  const offset = Decimal.min(hold.debtOffsetArs, debtRetained);
  debtRetained = debtRetained.minus(offset);
  const surchargeFee = hold.applicationFeeArs.minus(hold.commissionArs).minus(hold.debtOffsetArs);
  const surcharge =
    surchargeFee.lessThanOrEqualTo(0) || debtRetained.greaterThanOrEqualTo(surchargeFee)
      ? hold.debtSurchargeArs
      : hold.debtSurchargeArs.times(debtRetained).dividedBy(surchargeFee).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  const surchargeFeeRetained = Decimal.max(0, Decimal.min(debtRetained, surchargeFee));
  // Lo que MP haya retenido de más (no debería pasar) queda como comisión: es lo que se cobró.
  const extra = Decimal.max(0, retainedArs.minus(hold.applicationFeeArs));
  return {
    commissionArs: commission.plus(extra),
    debtOffsetArs: offset,
    debtSurchargeArs: surcharge,
    debtSurchargeFeeArs: surchargeFeeRetained,
  };
}
