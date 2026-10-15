import { describe, expect, it } from "vitest";
import {
  RECURRENCE_WEEKDAY as D,
  argentinaWeekday,
  formatArgentinaShortDay,
  nextRecurrenceOccurrence,
} from "../src/config/trip-recurrence";

// Todas las fechas en UTC; Argentina es UTC-3. 2026-10-09 es viernes.
const FRIDAY_8AM_AR = new Date("2026-10-09T11:00:00.000Z");

describe("nextRecurrenceOccurrence", () => {
  it("todos los viernes: la semana siguiente a la misma hora", () => {
    const next = nextRecurrenceOccurrence({
      departureAt: FRIDAY_8AM_AR,
      weekdays: [D.FRIDAY],
      until: null,
      now: new Date("2026-10-09T12:00:00.000Z"),
    });
    expect(next?.toISOString()).toBe("2026-10-16T11:00:00.000Z");
  });

  it("L-V-D: después del viernes sigue el domingo y después el lunes", () => {
    const weekdays = [D.MONDAY, D.FRIDAY, D.SUNDAY];
    const sunday = nextRecurrenceOccurrence({
      departureAt: FRIDAY_8AM_AR,
      weekdays,
      until: null,
      now: new Date("2026-10-09T12:00:00.000Z"),
    });
    expect(sunday?.toISOString()).toBe("2026-10-11T11:00:00.000Z");
    const monday = nextRecurrenceOccurrence({ departureAt: sunday!, weekdays, until: null, now: sunday! });
    expect(monday?.toISOString()).toBe("2026-10-12T11:00:00.000Z");
  });

  it("cruza de mes y de año", () => {
    // Jueves 2026-12-31 20:00 AR, todos los jueves → jueves 2027-01-07.
    const next = nextRecurrenceOccurrence({
      departureAt: new Date("2026-12-31T23:00:00.000Z"),
      weekdays: [D.THURSDAY],
      until: null,
      now: new Date("2026-12-31T23:30:00.000Z"),
    });
    expect(next?.toISOString()).toBe("2027-01-07T23:00:00.000Z");
  });

  it("conserva la hora de pared aunque en UTC sea el día siguiente (23:30 AR)", () => {
    // Viernes 2026-10-09 23:30 AR = sábado 02:30 UTC.
    const next = nextRecurrenceOccurrence({
      departureAt: new Date("2026-10-10T02:30:00.000Z"),
      weekdays: [D.FRIDAY],
      until: null,
      now: new Date("2026-10-10T03:00:00.000Z"),
    });
    expect(next?.toISOString()).toBe("2026-10-17T02:30:00.000Z");
    expect(argentinaWeekday(next!)).toBe(D.FRIDAY);
  });

  it("recurrenceUntil es inclusive", () => {
    const now = new Date("2026-10-09T12:00:00.000Z");
    const base = { departureAt: FRIDAY_8AM_AR, weekdays: [D.FRIDAY], now };
    expect(nextRecurrenceOccurrence({ ...base, until: "2026-10-16" })?.toISOString()).toBe("2026-10-16T11:00:00.000Z");
    expect(nextRecurrenceOccurrence({ ...base, until: "2026-10-15" })).toBeNull();
  });

  it("con el barrido caído varios ciclos, la fecha sale después de now y no nace vencida", () => {
    const next = nextRecurrenceOccurrence({
      departureAt: FRIDAY_8AM_AR,
      weekdays: [D.FRIDAY],
      until: null,
      now: new Date("2026-10-28T15:00:00.000Z"), // miércoles, 19 días después
    });
    expect(next?.toISOString()).toBe("2026-10-30T11:00:00.000Z");
  });

  it("si now es el mismo día pero antes de la hora, usa ese mismo día", () => {
    const next = nextRecurrenceOccurrence({
      departureAt: FRIDAY_8AM_AR,
      weekdays: [D.FRIDAY],
      until: null,
      now: new Date("2026-10-16T10:00:00.000Z"), // viernes siguiente 07:00 AR
    });
    expect(next?.toISOString()).toBe("2026-10-16T11:00:00.000Z");
  });

  it("sin días devuelve null", () => {
    expect(nextRecurrenceOccurrence({ departureAt: FRIDAY_8AM_AR, weekdays: [], until: null, now: FRIDAY_8AM_AR })).toBeNull();
  });
});

describe("formatArgentinaShortDay", () => {
  it("usa el huso argentino", () => {
    expect(formatArgentinaShortDay(FRIDAY_8AM_AR)).toBe("vie 9/10");
    expect(formatArgentinaShortDay("2026-10-10T02:30:00.000Z")).toBe("vie 9/10");
  });
});
