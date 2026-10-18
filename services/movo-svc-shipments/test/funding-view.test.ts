import { describe, it, expect } from "vitest";
import { OfferStatus, ShipmentStatus } from "@movo/shared";
import {
  computeSenderFundingView,
  isLatestFundingLapseForCarrier,
  FundingViewHold,
  SenderFundingViewInput,
  toCarrierFundingView,
} from "../src/domain/funding";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = new Date("2026-10-11T12:00:00.000Z");
const CARRIER = "carrier-1";

describe("isLatestFundingLapseForCarrier", () => {
  const event = {
    fromStatus: ShipmentStatus.ASSIGNMENT_PENDING,
    toStatus: ShipmentStatus.PUBLISHED,
    assignmentCarrierId: CARRIER,
    createdAt: NOW,
  };
  const lapsedOffer = { carrierId: CARRIER, status: OfferStatus.ASSIGNMENT_LAPSED, createdAt: new Date(NOW.getTime() - DAY) };

  it("asocia el aviso solo con la última asignación vencida", () => {
    expect(isLatestFundingLapseForCarrier(event, CARRIER, [lapsedOffer])).toBe(true);
    expect(isLatestFundingLapseForCarrier({ ...event, assignmentCarrierId: "otro" }, CARRIER, [lapsedOffer])).toBe(false);
    expect(isLatestFundingLapseForCarrier({ ...event, fromStatus: ShipmentStatus.ASSIGNED }, CARRIER, [lapsedOffer])).toBe(false);
    expect(isLatestFundingLapseForCarrier(event, CARRIER, [lapsedOffer, { ...lapsedOffer, status: OfferStatus.REJECTED, createdAt: new Date(NOW.getTime() + 1) }])).toBe(false);
  });
});

function input(overrides: Partial<SenderFundingViewInput> = {}): SenderFundingViewInput {
  return {
    status: ShipmentStatus.ASSIGNMENT_PENDING,
    carrierId: CARRIER,
    amountArs: 18400,
    pickupStart: new Date(NOW.getTime() + DAY),
    payUntil: new Date(NOW.getTime() + 30 * 60 * 1000),
    nearPickupDays: 3,
    statusChangedAt: new Date(NOW.getTime() - 5 * 60 * 1000),
    hold: null,
    lastEvent: null,
    now: NOW,
    ...overrides,
  };
}

function hold(overrides: Partial<FundingViewHold> = {}): FundingViewHold {
  return {
    status: "rejected",
    failureReason: "insufficient_funds",
    carrierId: CARRIER,
    amountArs: 18400,
    wasAuthorized: false,
    cardBrand: "visa",
    cardLast4: "3704",
    createdAt: new Date(NOW.getTime() - 60 * 1000).toISOString(),
    ...overrides,
  };
}

describe("computeSenderFundingView (MOVO-211)", () => {
  describe("assigned_unfunded: ventana de confirmación", () => {
    const farPickup = new Date(NOW.getTime() + 10 * DAY);

    it("con la ventana cerrada: awaiting_window con la fecha de apertura (retiro − N días)", () => {
      const view = computeSenderFundingView(
        input({ status: ShipmentStatus.ASSIGNED_UNFUNDED, pickupStart: farPickup, payUntil: new Date(farPickup.getTime() - DAY) }),
      );
      expect(view).toEqual({
        viewer: "sender",
        phase: "awaiting_window",
        windowOpensAt: new Date(farPickup.getTime() - 3 * DAY).toISOString(),
        payUntil: new Date(farPickup.getTime() - DAY).toISOString(),
        amountArs: 18400,
      });
    });

    it("borde: exactamente a N días la ventana ya está abierta; a N días + 1h, todavía no", () => {
      const atN = computeSenderFundingView(
        input({ status: ShipmentStatus.ASSIGNED_UNFUNDED, pickupStart: new Date(NOW.getTime() + 3 * DAY) }),
      );
      expect(atN?.phase).toBe("payment_due");
      const later = computeSenderFundingView(
        input({ status: ShipmentStatus.ASSIGNED_UNFUNDED, pickupStart: new Date(NOW.getTime() + 3 * DAY + HOUR) }),
      );
      expect(later?.phase).toBe("awaiting_window");
    });

    it("con la ventana abierta y sin intento: payment_due de ruta lejana", () => {
      const view = computeSenderFundingView(input({ status: ShipmentStatus.ASSIGNED_UNFUNDED }));
      expect(view).toMatchObject({ phase: "payment_due", route: "far", lastAttempt: "none", holdLost: false, card: null });
    });

    it("holdLost cuando la reserva confirmada se perdió (assigned → assigned_unfunded)", () => {
      const view = computeSenderFundingView(
        input({
          status: ShipmentStatus.ASSIGNED_UNFUNDED,
          lastEvent: { fromStatus: ShipmentStatus.ASSIGNED, toStatus: ShipmentStatus.ASSIGNED_UNFUNDED, createdAt: NOW },
          hold: hold({ status: "cancelled", failureReason: null, createdAt: new Date(NOW.getTime() - DAY).toISOString() }),
        }),
      );
      // El hold perdido es anterior al estado actual: no cuenta como intento de esta reconfirmación.
      expect(view).toMatchObject({ phase: "payment_due", holdLost: true, lastAttempt: "none" });
    });
  });

  describe("payment_due: último intento", () => {
    it("rechazado: motivo y tarjeta", () => {
      expect(computeSenderFundingView(input({ hold: hold() }))).toMatchObject({
        phase: "payment_due",
        route: "near",
        lastAttempt: "rejected",
        failureReason: "insufficient_funds",
        card: { brand: "visa", lastFour: "3704" },
      });
    });

    it("en revisión de MP (o autorizado sin confirmar todavía): in_process", () => {
      expect(computeSenderFundingView(input({ hold: hold({ status: "in_process", failureReason: null }) }))).toMatchObject({
        lastAttempt: "in_process",
      });
      expect(computeSenderFundingView(input({ hold: hold({ status: "authorized", failureReason: null }) }))).toMatchObject({
        lastAttempt: "in_process",
      });
    });

    it("creating abandonado: none (pago sin terminar)", () => {
      expect(computeSenderFundingView(input({ hold: hold({ status: "creating", failureReason: null }) }))).toMatchObject({
        lastAttempt: "none",
        failureReason: null,
      });
    });

    it("un hold de otro transportista o de una asignación anterior no cuenta como intento", () => {
      expect(computeSenderFundingView(input({ hold: hold({ carrierId: "otro" }) }))).toMatchObject({ lastAttempt: "none" });
      expect(
        computeSenderFundingView(input({ hold: hold({ createdAt: new Date(NOW.getTime() - DAY).toISOString() }) })),
      ).toMatchObject({ lastAttempt: "none" });
    });

    it("payments no respondió: lastAttempt null, sin tarjeta", () => {
      expect(computeSenderFundingView(input({ hold: undefined }))).toMatchObject({
        phase: "payment_due",
        lastAttempt: null,
        failureReason: null,
        card: null,
      });
    });
  });

  it("assigned / in_transit / delivered: held con la tarjeta si se conoce", () => {
    for (const status of [ShipmentStatus.ASSIGNED, ShipmentStatus.IN_TRANSIT, ShipmentStatus.DELIVERED]) {
      expect(computeSenderFundingView(input({ status, hold: hold({ status: "authorized" }) }))).toEqual({
        viewer: "sender",
        phase: "held",
        amountArs: 18400,
        card: { brand: "visa", lastFour: "3704" },
      });
    }
    expect(computeSenderFundingView(input({ status: ShipmentStatus.ASSIGNED, hold: undefined }))).toMatchObject({
      phase: "held",
      card: null,
    });
  });

  it("completed: captured con la fecha del cambio de estado", () => {
    expect(computeSenderFundingView(input({ status: ShipmentStatus.COMPLETED, statusChangedAt: NOW }))).toEqual({
      viewer: "sender",
      phase: "captured",
      amountArs: 18400,
      at: NOW.toISOString(),
    });
  });

  it("cancelled: released solo si hubo una reserva que se liberó", () => {
    expect(
      computeSenderFundingView(input({ status: ShipmentStatus.CANCELLED, hold: hold({ status: "cancelled", wasAuthorized: true }) })),
    ).toEqual({ viewer: "sender", phase: "released", amountArs: 18400, penaltyArs: null, penaltyStatus: null });
    expect(computeSenderFundingView(input({ status: ShipmentStatus.CANCELLED, hold: hold({ status: "cancelled" }) }))).toBeNull();
    expect(computeSenderFundingView(input({ status: ShipmentStatus.CANCELLED, hold: hold() }))).toBeNull();
    expect(computeSenderFundingView(input({ status: ShipmentStatus.CANCELLED, hold: null }))).toBeNull();
  });

  it("usa el monto realmente intentado o retenido, incluido el recargo por deuda", () => {
    expect(computeSenderFundingView(input({ hold: hold({ amountArs: 20400 }) }))).toMatchObject({ amountArs: 20400 });
    expect(computeSenderFundingView(input({ status: ShipmentStatus.ASSIGNED, hold: hold({ status: "authorized", amountArs: 20400 }) })))
      .toMatchObject({ amountArs: 20400 });
    expect(computeSenderFundingView(input({ status: ShipmentStatus.CANCELLED, hold: hold({ status: "cancelled", wasAuthorized: true, amountArs: 20400 }), cancellationPenaltyArs: 1500, cancellationPenaltyStatus: "debt" })))
      .toMatchObject({ amountArs: 20400, penaltyArs: 1500, penaltyStatus: "debt" });
  });

  it("published tras revertir: lapsed con el motivo según de dónde salió", () => {
    const base = { status: ShipmentStatus.PUBLISHED, carrierId: null, amountArs: null, payUntil: null };
    expect(
      computeSenderFundingView(
        input({
          ...base,
          lastEvent: { fromStatus: ShipmentStatus.ASSIGNMENT_PENDING, toStatus: ShipmentStatus.PUBLISHED, createdAt: NOW },
        }),
      ),
    ).toEqual({ viewer: "sender", phase: "lapsed", reason: "payment_timeout", at: NOW.toISOString() });
    expect(
      computeSenderFundingView(
        input({
          ...base,
          lastEvent: { fromStatus: ShipmentStatus.ASSIGNED_UNFUNDED, toStatus: ShipmentStatus.PUBLISHED, createdAt: NOW },
        }),
      ),
    ).toMatchObject({ phase: "lapsed", reason: "window_expired" });
    // Publicado por el receptor (nunca tuvo transportista): nada que mostrar.
    expect(
      computeSenderFundingView(
        input({
          ...base,
          lastEvent: {
            fromStatus: ShipmentStatus.AWAITING_RECEIVER_CONFIRMATION,
            toStatus: ShipmentStatus.PUBLISHED,
            createdAt: NOW,
          },
        }),
      ),
    ).toBeNull();
  });
});

describe("toCarrierFundingView (MOVO-211 AC2)", () => {
  it("pago pendiente sin montos, tarjeta ni motivos", () => {
    const view = toCarrierFundingView(computeSenderFundingView(input({ hold: hold() })));
    expect(view).toEqual({
      viewer: "carrier",
      phase: "sender_payment_pending",
      payUntil: new Date(NOW.getTime() + 30 * 60 * 1000).toISOString(),
    });
  });

  it("reservado sin monto ni tarjeta", () => {
    expect(toCarrierFundingView(computeSenderFundingView(input({ status: ShipmentStatus.ASSIGNED, hold: hold() })))).toEqual({
      viewer: "carrier",
      phase: "held",
    });
  });

  it("cobrado, liberado o sin datos: nada", () => {
    expect(toCarrierFundingView(computeSenderFundingView(input({ status: ShipmentStatus.COMPLETED })))).toBeNull();
    expect(toCarrierFundingView(null)).toBeNull();
  });
});
