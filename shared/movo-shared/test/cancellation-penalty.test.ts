import { describe, expect, it } from "vitest";
import {
  CANCELLATION_PENALTY_FREE_HOURS,
  computeCancellationPenalty,
  computeCarrierWithdrawalPenalty,
  isSenderCancellableStatus,
} from "../src/config/cancellation-penalty";
import { ShipmentStatus } from "../src/types/shipment";

// Ventana acordada: 15/10 de 14:00 a 18:00 en Argentina (17:00 a 21:00 UTC).
const START = new Date("2026-10-15T17:00:00.000Z");
const END = new Date("2026-10-15T21:00:00.000Z");
const FREE_UNTIL = new Date(START.getTime() - CANCELLATION_PENALTY_FREE_HOURS * 60 * 60 * 1000);

const quote = (now: Date, overrides: Partial<Parameters<typeof computeCancellationPenalty>[0]> = {}) =>
  computeCancellationPenalty({
    status: ShipmentStatus.ASSIGNED,
    agreedPriceArs: 1150,
    pickupWindowStart: START,
    pickupWindowEnd: END,
    now,
    ...overrides,
  });

describe("computeCancellationPenalty (MOVO-307)", () => {
  it("MOVO-340: un retiro el mismo día cuenta por instantes, aunque el día local y el UTC no coincidan", () => {
    // 22:00 del 24/10 en Argentina (01:00 del 25/10 UTC); retiro de 23:00 a 23:59 del 24/10.
    const sameDay = {
      pickupWindowStart: new Date("2026-10-25T02:00:00.000Z"),
      pickupWindowEnd: new Date("2026-10-25T02:59:00.000Z"),
    };
    expect(quote(new Date("2026-10-25T01:00:00.000Z"), sameDay)).toMatchObject({
      penaltyArs: 287.5,
      reason: "late_cancellation",
    });
  });

  it("con 12 h o más hasta el retiro es sin cargo y dice hasta cuándo", () => {
    expect(quote(new Date("2026-10-14T12:00:00.000Z"))).toEqual({
      penaltyArs: 0,
      reason: "before_free_deadline",
      freeUntil: FREE_UNTIL,
    });
  });

  it("umbral exacto: a las 12 h justas es sin cargo; un instante después ya cobra", () => {
    expect(quote(FREE_UNTIL).reason).toBe("before_free_deadline");
    expect(quote(new Date(FREE_UNTIL.getTime() + 1))).toMatchObject({ reason: "late_cancellation", penaltyArs: 287.5 });
  });

  it("con menos de 12 h y la ventana abierta cobra el 25 % del precio acordado", () => {
    expect(quote(new Date("2026-10-15T18:30:00.000Z"))).toEqual({
      penaltyArs: 287.5,
      reason: "late_cancellation",
      freeUntil: FREE_UNTIL,
    });
  });

  it("hasta el último instante de la ventana sigue cobrando; después es sin cargo", () => {
    expect(quote(END).reason).toBe("late_cancellation");
    expect(quote(new Date(END.getTime() + 1))).toMatchObject({ penaltyArs: 0, reason: "pickup_window_closed" });
  });

  it("redondea a 2 decimales", () => {
    expect(quote(START, { agreedPriceArs: 1000.03 }).penaltyArs).toBe(250.01);
  });

  it("oferta con franja propuesta: se mide contra la ventana acordada que recibe, no la pedida", () => {
    // El transportista propuso el 16/10 de 9 a 11 (12:00-14:00 UTC): a las 9:00 UTC del 16 faltan 3 h.
    const proposed = { pickupWindowStart: new Date("2026-10-16T12:00:00.000Z"), pickupWindowEnd: new Date("2026-10-16T14:00:00.000Z") };
    expect(quote(new Date("2026-10-15T23:00:00.000Z"), proposed).reason).toBe("before_free_deadline");
    expect(quote(new Date("2026-10-16T09:00:00.000Z"), proposed).reason).toBe("late_cancellation");
  });

  it.each([ShipmentStatus.PUBLISHED, ShipmentStatus.ASSIGNMENT_PENDING, ShipmentStatus.ASSIGNED_UNFUNDED])(
    "%s nunca tiene penalidad",
    (status) => {
      expect(quote(START, { status })).toEqual({ penaltyArs: 0, reason: "not_assigned", freeUntil: null });
    }
  );
});

describe("computeCancellationPenalty con llegada del transportista (MOVO-270)", () => {
  const afterWindow = new Date(END.getTime() + 1);

  it("con la ventana cerrada y el transportista que llegó cobra el 25 % con motivo propio", () => {
    expect(quote(afterWindow, { carrierArrivedAtPickup: true })).toEqual({
      penaltyArs: 287.5,
      reason: "carrier_arrived",
      freeUntil: FREE_UNTIL,
    });
  });

  it("sin evidencia de llegada sigue sin cargo", () => {
    expect(quote(afterWindow, { carrierArrivedAtPickup: false })).toMatchObject({ penaltyArs: 0, reason: "pickup_window_closed" });
  });

  it("con la ventana abierta la llegada no cambia nada: sigue siendo cancelación tardía", () => {
    expect(quote(START, { carrierArrivedAtPickup: true }).reason).toBe("late_cancellation");
    expect(quote(new Date("2026-10-14T12:00:00.000Z"), { carrierArrivedAtPickup: true }).reason).toBe("before_free_deadline");
  });

  it("un envío que no está assigned nunca paga, aunque haya llegada", () => {
    expect(quote(afterWindow, { status: ShipmentStatus.ASSIGNMENT_PENDING, carrierArrivedAtPickup: true }).reason).toBe(
      "not_assigned"
    );
  });
});

describe("computeCarrierWithdrawalPenalty (MOVO-310)", () => {
  const withdrawal = (now: Date) =>
    computeCarrierWithdrawalPenalty({ agreedPriceArs: 1150, pickupWindowStart: START, pickupWindowEnd: END, now });

  it("mismo umbral de 12 h que el emisor, sin depender del estado del envío", () => {
    expect(withdrawal(new Date("2026-10-14T12:00:00.000Z")).reason).toBe("before_free_deadline");
    expect(withdrawal(START)).toEqual({ penaltyArs: 287.5, reason: "late_cancellation", freeUntil: FREE_UNTIL });
  });

  it("con la ventana ya cerrada también cobra: el que faltó es el transportista", () => {
    expect(withdrawal(new Date(END.getTime() + 60 * 60 * 1000))).toEqual({
      penaltyArs: 287.5,
      reason: "late_cancellation",
      freeUntil: FREE_UNTIL,
    });
  });
});

describe("isSenderCancellableStatus (MOVO-340)", () => {
  it("se cancela antes del retiro, nunca con el paquete ya retirado", () => {
    expect(isSenderCancellableStatus(ShipmentStatus.PUBLISHED)).toBe(true);
    expect(isSenderCancellableStatus(ShipmentStatus.ASSIGNED)).toBe(true);
    expect(isSenderCancellableStatus(ShipmentStatus.IN_TRANSIT)).toBe(false);
    expect(isSenderCancellableStatus(ShipmentStatus.DISPUTED)).toBe(false);
  });
});
