import { describe, it, expect } from "vitest";
import { isPickupMissed, isTransitAnomalous, pickupMissedInstant, transitAnomalyInstant } from "../src/domain/expiration";

// Fechas/horas de pared argentinas ancladas como UTC (mismo criterio que `@db.Date`/`@db.Time`).
const PICKUP_DATE = new Date("2026-09-23T00:00:00.000Z");
const WINDOW_END = new Date("1970-01-01T12:00:00.000Z"); // 12:00 AR = 15:00Z

describe("expiration (MOVO-258)", () => {
  describe("retiro no realizado (D1)", () => {
    it("el instante es el cierre de la ventana más el margen de gracia", () => {
      expect(pickupMissedInstant(PICKUP_DATE, WINDOW_END, 24).toISOString()).toBe("2026-09-24T15:00:00.000Z");
    });

    it("dentro del margen de gracia todavía no cuenta como no realizado", () => {
      expect(isPickupMissed(PICKUP_DATE, WINDOW_END, 24, new Date("2026-09-24T14:59:00.000Z"))).toBe(false);
    });

    it("pasado el margen de gracia sí", () => {
      expect(isPickupMissed(PICKUP_DATE, WINDOW_END, 24, new Date("2026-09-24T15:01:00.000Z"))).toBe(true);
    });

    it("con gracia 0 vence apenas cierra la ventana", () => {
      expect(isPickupMissed(PICKUP_DATE, WINDOW_END, 0, new Date("2026-09-23T15:01:00.000Z"))).toBe(true);
    });
  });

  describe("in_transit anómalo (D4)", () => {
    const base = {
      inTransitSince: new Date("2026-09-23T13:00:00.000Z"), // 10:00 AR
      estimatedDeliveryDate: new Date("2026-09-23T00:00:00.000Z"),
      estimatedDeliveryTimeWindowStart: "16:00:00",
      estimatedDeliveryTimeWindowEnd: "18:00:00", // 21:00Z
      fallbackHours: 48,
    };

    it("entrega estimada + 50% de la duración estimada (retiro -> entrega)", () => {
      // duración 8h -> +4h sobre las 21:00Z
      expect(transitAnomalyInstant(base).toISOString()).toBe("2026-09-24T01:00:00.000Z");
      expect(isTransitAnomalous(base, new Date("2026-09-24T00:59:00.000Z"))).toBe(false);
      expect(isTransitAnomalous(base, new Date("2026-09-24T01:01:00.000Z"))).toBe(true);
    });

    it("sin fin de franja usa el inicio de la franja", () => {
      const onlyStart = { ...base, estimatedDeliveryTimeWindowEnd: null };
      expect(transitAnomalyInstant(onlyStart).toISOString()).toBe("2026-09-23T22:00:00.000Z"); // 19:00Z + 50% de 6h
    });

    it("sin entrega estimada usa el plazo fijo desde el retiro", () => {
      const none = { ...base, estimatedDeliveryDate: null, estimatedDeliveryTimeWindowStart: null, estimatedDeliveryTimeWindowEnd: null };
      expect(transitAnomalyInstant(none).toISOString()).toBe("2026-09-25T13:00:00.000Z");
    });

    it("una estimada anterior al retiro real no genera duración negativa", () => {
      const early = { ...base, inTransitSince: new Date("2026-09-23T23:00:00.000Z") };
      expect(transitAnomalyInstant(early).toISOString()).toBe("2026-09-23T21:00:00.000Z");
    });
  });
});
