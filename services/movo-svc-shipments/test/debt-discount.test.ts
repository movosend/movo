import { describe, expect, it, vi } from "vitest";
import type { PaymentsClient } from "../src/adapters/payments-client";
import { previewDebtDiscounts } from "../src/utils/debt-discount";

describe("previewDebtDiscounts", () => {
  it("mapea descuentos por posición y conserva null donde no hay deuda", async () => {
    const client = { previewCarrierDebt: vi.fn().mockResolvedValue({
      pendingBalanceArs: 80, debtOffsetsArs: [80, 0],
    }) } as unknown as PaymentsClient;
    expect(await previewDebtDiscounts(client, "carrier", [100, 200])).toEqual([
      { amountArs: 80, reason: "pending_balance" }, null,
    ]);
    expect(client.previewCarrierDebt).toHaveBeenCalledWith("carrier", [100, 200]);
  });

  it("degrada a null si payments falla o supera el tope de 3 segundos", async () => {
    const failing = { previewCarrierDebt: vi.fn().mockRejectedValue(new Error("caído")) } as unknown as PaymentsClient;
    expect(await previewDebtDiscounts(failing, "carrier", [100])).toEqual([null]);

    vi.useFakeTimers();
    try {
      const slow = { previewCarrierDebt: vi.fn().mockReturnValue(new Promise(() => {})) } as unknown as PaymentsClient;
      const result = previewDebtDiscounts(slow, "carrier", [100]);
      await vi.advanceTimersByTimeAsync(3_000);
      expect(await result).toEqual([null]);
    } finally {
      vi.useRealTimers();
    }
  });
});
