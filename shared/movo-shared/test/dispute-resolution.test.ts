import { describe, expect, it } from "vitest";
import {
  disputeFinalShipmentStatus,
  disputePaymentAction,
  disputeRatingWinners,
  minimumPartialCaptureArs,
  splitDisputeStake,
} from "../src/config/dispute-resolution";
import { estimateMpFeeArs } from "../src/config/commission";
import { renderNotificationTrigger } from "../src/config/notification-templates";

describe("matriz de resolución de disputas (MOVO-337, DD-056)", () => {
  it.each([
    ["assigned", "sender", "none"],
    ["assigned", "carrier", "ledger_credit"],
    ["assigned", "partial", "ledger_credit"],
    ["in_transit", "sender", "release_hold"],
    ["in_transit", "carrier", "capture_hold"],
    ["in_transit", "partial", "capture_partial"],
    ["delivered", "sender", "refund_full"],
    ["delivered", "carrier", "none"],
    ["delivered", "partial", "refund_partial"],
    ["completed", "sender", "refund_full"],
    ["completed", "carrier", "none"],
    ["completed", "partial", "refund_partial"],
  ] as const)("%s + %s -> %s", (status, outcome, action) => {
    expect(disputePaymentAction(status, outcome)).toBe(action);
  });

  it("el estado final es cancelled solo a favor del emisor", () => {
    expect(disputeFinalShipmentStatus("sender")).toBe("cancelled");
    expect(disputeFinalShipmentStatus("carrier")).toBe("completed");
    expect(disputeFinalShipmentStatus("partial")).toBe("completed");
  });

  it("califica el ganador; en partial, las dos partes", () => {
    expect(disputeRatingWinners("sender")).toEqual(["sender"]);
    expect(disputeRatingWinners("carrier")).toEqual(["carrier"]);
    expect(disputeRatingWinners("partial")).toEqual(["sender", "carrier"]);
  });
});

describe("splitDisputeStake", () => {
  it("emisor y transportista se llevan todo", () => {
    expect(splitDisputeStake(1000, "sender", {})).toEqual({ carrierAmountArs: 0, senderAmountArs: 1000 });
    expect(splitDisputeStake(1000, "carrier", {})).toEqual({ carrierAmountArs: 1000, senderAmountArs: 0 });
  });

  it("partial con un porcentaje del set", () => {
    expect(splitDisputeStake(1000, "partial", { percentage: 25 })).toEqual({ carrierAmountArs: 250, senderAmountArs: 750 });
  });

  it("partial con un monto libre", () => {
    expect(splitDisputeStake(1000, "partial", { amountArs: 333.33 })).toEqual({ carrierAmountArs: 333.33, senderAmountArs: 666.67 });
  });

  it("rechaza elecciones inválidas", () => {
    expect(splitDisputeStake(1000, "partial", {})).toEqual({ error: "invalid_choice" });
    expect(splitDisputeStake(1000, "partial", { percentage: 25, amountArs: 100 })).toEqual({ error: "invalid_choice" });
    expect(splitDisputeStake(1000, "partial", { percentage: 30 })).toEqual({ error: "invalid_choice" });
    expect(splitDisputeStake(1000, "sender", { percentage: 25 })).toEqual({ error: "invalid_choice" });
    expect(splitDisputeStake(1000, "partial", { amountArs: -5 })).toEqual({ error: "invalid_choice" });
  });

  it("un monto libre no puede llegar al total", () => {
    expect(splitDisputeStake(1000, "partial", { amountArs: 1000 })).toEqual({ error: "above_maximum" });
    expect(splitDisputeStake(1000, "partial", { amountArs: 1500 })).toEqual({ error: "above_maximum" });
  });
});

describe("minimumPartialCaptureArs", () => {
  it("es el menor monto cuyo neto de la comisión de MP supera el application_fee", () => {
    for (const fee of [150, 1234.56, 4000]) {
      const minimum = minimumPartialCaptureArs(fee);
      const net = (amount: number) => Math.round((amount - estimateMpFeeArs(amount)) * 100) / 100;
      expect(net(minimum)).toBeGreaterThan(fee);
      expect(net(Math.round((minimum - 0.01) * 100) / 100)).toBeLessThanOrEqual(fee);
    }
  });
});

describe("push disputeResolved", () => {
  it("no lleva montos ni el razonamiento, e invita a calificar al ganador", () => {
    const winner = renderNotificationTrigger("disputeResolved", { result: "favorable", ratingPending: true });
    expect(winner.body).toContain("a tu favor");
    expect(winner.body).toContain("calificar");
    expect(winner.body).not.toMatch(/\$|\d/);
    expect(renderNotificationTrigger("disputeResolved", { result: "unfavorable", ratingPending: false }).body).not.toContain("calificar");
    expect(renderNotificationTrigger("disputeResolved", { result: "neutral", ratingPending: false }).body).toContain("ibas a recibir");
  });
});
