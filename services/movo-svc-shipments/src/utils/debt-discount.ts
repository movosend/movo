import type { CarrierDebtDiscount } from "@movo/shared";
import type { PaymentsClient } from "../adapters/payments-client";

export const DEBT_DISCOUNT_TIMEOUT_MS = 3_000;

export function debtDiscount(amountArs: number): CarrierDebtDiscount | null {
  return amountArs > 0 ? { amountArs, reason: "pending_balance" } : null;
}

/** Preview de display: una caída o demora de payments no bloquea el feed. */
export async function previewDebtDiscounts(
  paymentsClient: PaymentsClient | undefined,
  carrierId: string,
  amountsArs: number[],
): Promise<Array<CarrierDebtDiscount | null>> {
  if (!paymentsClient || amountsArs.length === 0) return amountsArs.map(() => null);
  let timer: NodeJS.Timeout | undefined;
  try {
    const preview = await Promise.race([
      paymentsClient.previewCarrierDebt(carrierId, amountsArs),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), DEBT_DISCOUNT_TIMEOUT_MS);
      }),
    ]);
    return amountsArs.map((_, index) => debtDiscount(preview?.debtOffsetsArs[index] ?? 0));
  } catch {
    return amountsArs.map(() => null);
  } finally {
    clearTimeout(timer);
  }
}
