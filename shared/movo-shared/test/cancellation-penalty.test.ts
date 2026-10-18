import { describe, expect, it } from "vitest";
import {
  CANCELLATION_PENALTY_FREE_HOURS,
  computeCancellationPenalty,
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
