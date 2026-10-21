import type { ShipmentSettlementResponse } from "@movo/shared/dist/types/settlement";
import {
  carrierDebtNotice,
  carrierWithdrawalQuoteView,
  PICKUP_WINDOW_CLOSED_REASON,
  cancellationQuoteView,
  carrierCompensationView,
  formatCancellationDateTime,
  penaltyMismatchNotice,
  senderCancelledPaymentView,
} from "../src/lib/cancellation-format";

describe("formatCancellationDateTime", () => {
  it("arma 'día dd mes a las HH:MM' y devuelve null ante una fecha inválida o ausente", () => {
    // Se compara contra la hora local del entorno: el formato sigue la zona del dispositivo.
    const iso = "2026-10-16T11:00:00.000Z";
    const date = new Date(iso);
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    expect(formatCancellationDateTime(iso)).toMatch(new RegExp(`^\\S+ ${date.getDate()} \\S+ a las ${hh}:${mm}$`));
    expect(formatCancellationDateTime("no-es-fecha")).toBeNull();
    expect(formatCancellationDateTime(null)).toBeNull();
  });
});

describe("cancellationQuoteView", () => {
  const freeUntil = "2026-10-16T11:00:00.000Z";

  it("before_free_deadline → sin cargo, con hasta cuándo y lo reservado", () => {
    const view = cancellationQuoteView({ penaltyArs: 0, reason: "before_free_deadline", freeUntil }, 18500);
    expect(view).toEqual({ kind: "free", reservedArs: 18500, freeUntilLabel: formatCancellationDateTime(freeUntil) });
  });

  it("late_cancellation → penalidad, lo que se libera y la proporción de la barra", () => {
    const view = cancellationQuoteView({ penaltyArs: 4625, reason: "late_cancellation", freeUntil }, 18500);
    expect(view).toEqual({ kind: "penalty", reservedArs: 18500, penaltyArs: 4625, releasedArs: 13875, penaltyRatio: 0.25 });
  });

  it("late_cancellation con centavos no arrastra error de coma flotante", () => {
    const view = cancellationQuoteView({ penaltyArs: 287.5, reason: "late_cancellation", freeUntil }, 1150);
    expect(view).toMatchObject({ releasedArs: 862.5 });
  });

  it("pickup_window_closed → sin cargo con el motivo", () => {
    const view = cancellationQuoteView({ penaltyArs: 0, reason: "pickup_window_closed", freeUntil }, 18500);
    expect(view).toEqual({ kind: "expired", reservedArs: 18500, reasonText: PICKUP_WINDOW_CLOSED_REASON });
  });

  it("not_assigned → sin reserva", () => {
    expect(cancellationQuoteView({ penaltyArs: 0, reason: "not_assigned", freeUntil: null }, null)).toEqual({ kind: "noHold" });
  });
});

describe("penaltyMismatchNotice", () => {
  it("cuando sube, dice de cuánto a cuánto y por qué", () => {
    expect(penaltyMismatchNotice(3700, 5550).body).toBe(
      "La penalidad pasó de $3.700 a $5.550 porque se acercó la hora del retiro.",
    );
  });

  it("cuando pasa de sin cargo a penalidad", () => {
    expect(penaltyMismatchNotice(0, 4625).body).toBe(
      "Ahora la cancelación tiene una penalidad de $4.625 porque se acercó la hora del retiro.",
    );
  });

  it("cuando baja a 0, dice que ya no corresponde", () => {
    expect(penaltyMismatchNotice(4625, 0)).toEqual({
      title: "El monto cambió. Revisalo antes de confirmar.",
      body: "Ya no corresponde cobrarte la penalidad de $4.625.",
    });
  });
});

describe("senderCancelledPaymentView", () => {
  const hold = { amountArs: 18500 };

  it("sin reserva no hay card", () => {
    expect(senderCancelledPaymentView({ cancellationPenaltyArs: null, cancellationPenaltyStatus: null }, null)).toBeNull();
  });

  it("sin penalidad: 'Sin cargo' y se libera todo", () => {
    const view = senderCancelledPaymentView({ cancellationPenaltyArs: null, cancellationPenaltyStatus: null }, hold);
    expect(view).toMatchObject({
      processing: false,
      lines: [{ label: "Penalidad cobrada", value: "Sin cargo" }],
      releasedLabel: "Liberado en tu tarjeta",
      releasedArs: 18500,
      note: null,
    });
  });

  it("penalidad sin estado: no se muestra como 'Sin cargo', queda procesando", () => {
    const view = senderCancelledPaymentView({ cancellationPenaltyArs: 4625, cancellationPenaltyStatus: null }, hold);
    expect(view).toMatchObject({ processing: true, lines: [{ label: "Penalidad", value: "Calculando…" }], releasedArs: 18500 });
  });

  it("captured: penalidad cobrada y el resto liberado", () => {
    const view = senderCancelledPaymentView({ cancellationPenaltyArs: 4625, cancellationPenaltyStatus: "captured" }, hold);
    expect(view).toMatchObject({
      lines: [{ label: "Penalidad cobrada", value: "− $4.625", tone: "danger" }],
      releasedArs: 13875,
    });
  });

  it("pending: en proceso, lo que se va a liberar", () => {
    const view = senderCancelledPaymentView({ cancellationPenaltyArs: 4625, cancellationPenaltyStatus: "pending" }, hold);
    expect(view).toMatchObject({ processing: true, releasedLabel: "Se libera en tu tarjeta", releasedArs: 13875 });
  });

  it("debt: se liberó todo y la penalidad quedó como saldo", () => {
    const view = senderCancelledPaymentView({ cancellationPenaltyArs: 4625, cancellationPenaltyStatus: "debt" }, hold);
    expect(view).toMatchObject({
      lines: [{ label: "Penalidad pendiente", value: "$4.625", tone: "danger" }],
      releasedArs: 18500,
    });
    expect(view?.note).toMatch(/se suma a tu próximo pago/);
  });
});

describe("carrierCompensationView", () => {
  const base: ShipmentSettlementResponse = {
    shipmentId: "shipment-1",
    role: "carrier",
    kind: "cancellation_penalty",
    status: "credited",
    paidAmountArs: 287.5,
    debtCollectedArs: 0,
    paidAt: "2026-10-15T18:00:00.000Z",
    commissionArs: 150,
    mpFeeArs: 11.79,
    netAmountArs: 125.71,
  };

  it("acreditada: el neto real (≈ 11 %), no el 25 %", () => {
    expect(carrierCompensationView(base)).toMatchObject({ kind: "credited", penaltyArs: 287.5, netArs: 125.71 });
  });

  it("en proceso: neto estimado (comisión de Movo y estimado de MP)", () => {
    const view = carrierCompensationView({ ...base, status: "processing", mpFeeArs: null, netAmountArs: null, paidAt: null });
    expect(view).toMatchObject({ kind: "processing", commissionArs: 150 });
    expect(view?.kind !== "credited" && view?.estimatedNetArs).toBeGreaterThan(0);
    expect(view?.kind !== "credited" && view?.estimatedNetArs).toBeLessThan(137.5);
  });

  it("sin liquidación o de una entrega: no hay compensación que mostrar", () => {
    expect(carrierCompensationView(null)).toBeNull();
    expect(carrierCompensationView({ ...base, kind: "delivery" })).toBeNull();
  });
});

describe("carrierWithdrawalQuoteView (MOVO-314)", () => {
  it("sin penalidad: sin cargo", () => {
    expect(carrierWithdrawalQuoteView({ penaltyArs: 0 })).toEqual({ kind: "free" });
  });

  it("con penalidad: deuda por ese monto", () => {
    expect(carrierWithdrawalQuoteView({ penaltyArs: 2450 })).toEqual({ kind: "debt", penaltyArs: 2450 });
  });

  it("el aviso de deuda nombra el monto y que se descuenta de los próximos cobros (AC2)", () => {
    expect(carrierDebtNotice(2450)).toBe("Se te va a registrar una deuda de $2.450 que se descuenta de tus próximos cobros.");
  });
});
