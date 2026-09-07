import { describe, it, expect } from "vitest";
import { isPickupWindowExpired, pickupWindowEndInstant, toArgentinaCalendarDate } from "../src/domain/pickup-window";

describe("pickupWindowEndInstant", () => {
  it("suma el offset de Argentina (UTC-3) al reloj de pared anclado", () => {
    // pickupDate ancla el día como medianoche UTC (ver toEpochTime/MOVO-80); el
    // reloj de pared 12:00 en Argentina es en realidad 15:00 UTC.
    const pickupDate = new Date("2026-09-03T00:00:00.000Z");
    const pickupTimeWindowEnd = new Date("1970-01-01T12:00:00.000Z");

    expect(pickupWindowEndInstant(pickupDate, pickupTimeWindowEnd).toISOString()).toBe("2026-09-03T15:00:00.000Z");
  });
});

describe("isPickupWindowExpired", () => {
  it("una ventana ya cerrada está vencida", () => {
    const pickupDate = new Date("2026-08-30T00:00:00.000Z");
    const pickupTimeWindowEnd = new Date("1970-01-01T22:00:00.000Z");
    const now = new Date("2026-09-03T12:00:00.000Z");

    expect(isPickupWindowExpired(pickupDate, pickupTimeWindowEnd, now)).toBe(true);
  });

  it("una ventana futura no está vencida", () => {
    const pickupDate = new Date("2026-09-10T00:00:00.000Z");
    const pickupTimeWindowEnd = new Date("1970-01-01T12:00:00.000Z");
    const now = new Date("2026-09-03T12:00:00.000Z");

    expect(isPickupWindowExpired(pickupDate, pickupTimeWindowEnd, now)).toBe(false);
  });

  it("el mismo día, un minuto antes de que cierre, todavía no está vencida", () => {
    const pickupDate = new Date("2026-09-03T00:00:00.000Z");
    const pickupTimeWindowEnd = new Date("1970-01-01T12:00:00.000Z");
    // 14:59 UTC == 11:59 hora argentina, un minuto antes de que cierre (12:00 ARG == 15:00 UTC).
    const now = new Date("2026-09-03T14:59:00.000Z");

    expect(isPickupWindowExpired(pickupDate, pickupTimeWindowEnd, now)).toBe(false);
  });

  it("el mismo día, justo al cerrar, ya está vencida", () => {
    const pickupDate = new Date("2026-09-03T00:00:00.000Z");
    const pickupTimeWindowEnd = new Date("1970-01-01T12:00:00.000Z");
    const now = new Date("2026-09-03T15:00:01.000Z");

    expect(isPickupWindowExpired(pickupDate, pickupTimeWindowEnd, now)).toBe(true);
  });
});

describe("toArgentinaCalendarDate", () => {
  it("resta el offset de Argentina antes de leer el día calendario", () => {
    // 01:30 UTC del 9 sept es 22:30 del 8 sept en Argentina (UTC-3).
    expect(toArgentinaCalendarDate(new Date("2026-09-09T01:30:00.000Z")).toISOString()).toBe(
      "2026-09-08T00:00:00.000Z",
    );
  });

  it("un instante bien entrado en el día UTC no cruza de día en Argentina", () => {
    expect(toArgentinaCalendarDate(new Date("2026-09-09T13:00:00.000Z")).toISOString()).toBe(
      "2026-09-09T00:00:00.000Z",
    );
  });

  it("es la inversa de anclar pickupDate a medianoche y sumarle el offset (pickupWindowEndInstant)", () => {
    const pickupDate = new Date("2026-09-03T00:00:00.000Z");
    const instant = pickupWindowEndInstant(pickupDate, new Date("1970-01-01T00:00:00.000Z"));

    expect(toArgentinaCalendarDate(instant).toISOString()).toBe(pickupDate.toISOString());
  });
});
