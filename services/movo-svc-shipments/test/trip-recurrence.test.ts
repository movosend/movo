import { describe, it, expect } from "vitest";
import { TripStatus } from "@movo/shared";
import { isPhantomSeries, isStopRecurrencePatch, validateRecurrence } from "../src/domain/trip-recurrence";

// Viernes 2026-10-09 08:00 AR.
const FRIDAY = new Date("2026-10-09T11:00:00.000Z");

describe("validateRecurrence (MOVO-265)", () => {
  it("acepta días válidos que incluyen el de la salida", () => {
    expect(() => validateRecurrence({ weekdays: [1, 5], until: "2026-12-31", departureAt: FRIDAY })).not.toThrow();
  });

  it.each([
    ["sin días", [], null],
    ["días repetidos", [5, 5], null],
    ["día fuera de rango", [5, 7], null],
    ["sin el día de la salida", [1, 3], null],
    ["recurrenceUntil igual al día de salida", [5], "2026-10-09"],
    ["recurrenceUntil anterior a la salida", [5], "2026-10-01"],
  ])("400 VALIDATION_FAILED %s", (_label, weekdays, until) => {
    expect(() => validateRecurrence({ weekdays, until, departureAt: FRIDAY })).toThrow(
      expect.objectContaining({ statusCode: 400, code: "VALIDATION_FAILED" }),
    );
  });

  it("toma el día de la salida en huso argentino (viernes 23:30 AR = sábado UTC)", () => {
    const fridayNight = new Date("2026-10-10T02:30:00.000Z");
    expect(() => validateRecurrence({ weekdays: [5], until: null, departureAt: fridayNight })).not.toThrow();
    expect(() => validateRecurrence({ weekdays: [6], until: null, departureAt: fridayNight })).toThrow();
  });
});

describe("isStopRecurrencePatch (MOVO-265)", () => {
  it("es true si solo apaga la recurrencia", () => {
    expect(isStopRecurrencePatch({ recurrenceWeekdays: null })).toBe(true);
    expect(isStopRecurrencePatch({ recurrenceWeekdays: null, recurrenceUntil: null })).toBe(true);
    expect(isStopRecurrencePatch({ recurrenceWeekdays: null, vehicleType: undefined })).toBe(true);
  });

  it("es false si cambia los días o la fecha de fin, o si toca otro campo", () => {
    expect(isStopRecurrencePatch({ recurrenceWeekdays: [1] })).toBe(false);
    expect(isStopRecurrencePatch({ recurrenceUntil: "2026-12-31" })).toBe(false);
    expect(isStopRecurrencePatch({ recurrenceWeekdays: null, recurrenceUntil: "2026-12-31" })).toBe(false);
    expect(isStopRecurrencePatch({ recurrenceWeekdays: null, departureAt: FRIDAY })).toBe(false);
    expect(isStopRecurrencePatch({ vehicleType: "camioneta" })).toBe(false);
    expect(isStopRecurrencePatch({})).toBe(false);
  });
});

describe("isPhantomSeries (MOVO-265)", () => {
  const { EXPIRED, CANCELLED, COMPLETED } = TripStatus;

  it("3 expired seguidos (del más nuevo al más viejo) es fantasma", () => {
    expect(isPhantomSeries([EXPIRED, EXPIRED, EXPIRED])).toBe(true);
  });

  it("una cancelled o una completada corta la racha", () => {
    expect(isPhantomSeries([EXPIRED, CANCELLED, EXPIRED])).toBe(false);
    expect(isPhantomSeries([EXPIRED, EXPIRED, COMPLETED])).toBe(false);
  });

  it("con menos de 3 ocurrencias nunca es fantasma", () => {
    expect(isPhantomSeries([EXPIRED, EXPIRED])).toBe(false);
  });
});
