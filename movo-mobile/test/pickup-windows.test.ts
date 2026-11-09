import {
  availableWindowsFor,
  isTimeWindowEnded,
  offerDayOffsets,
  defaultPickupDate,
  pickerValueToPickupDate,
  pickupDateToPickerValue,
  todayInArgentina,
} from "../src/lib/pickup-windows";

// Instantes UTC; Argentina es UTC-3.
const at = (iso: string) => new Date(iso);

describe("pickup-windows (MOVO-340)", () => {
  it("hoy se calcula en Argentina: a las 23:30 el día UTC ya es el siguiente", () => {
    expect(todayInArgentina(at("2026-10-25T02:30:00.000Z"))).toBe("2026-10-24");
  });

  it("a las 08:00 quedan todas las franjas de hoy y el default es hoy", () => {
    const now = at("2026-10-24T11:00:00.000Z");
    expect(availableWindowsFor("2026-10-24", now).map((w) => w.start)).toEqual(["09:00", "12:00", "18:00"]);
    expect(defaultPickupDate(now)).toBe("2026-10-24");
  });

  it("DD-060: una franja en curso se puede elegir hasta que termina", () => {
    expect(availableWindowsFor("2026-10-24", at("2026-10-24T22:30:00.000Z")).map((w) => w.start)).toEqual(["18:00"]); // 19:30
    expect(availableWindowsFor("2026-10-24", at("2026-10-25T01:00:00.000Z"))).toEqual([]); // 22:00
  });

  it("sin franjas que queden hoy, el default es mañana", () => {
    const now = at("2026-10-25T01:30:00.000Z"); // 22:30
    expect(availableWindowsFor("2026-10-24", now)).toEqual([]);
    expect(defaultPickupDate(now)).toBe("2026-10-25");
  });

  it("a las 23:30 el default es mañana en Argentina, no pasado mañana", () => {
    expect(defaultPickupDate(at("2026-10-25T02:30:00.000Z"))).toBe("2026-10-25");
  });

  it("un día pasado o una fecha vacía no tienen franjas", () => {
    const now = at("2026-10-24T11:00:00.000Z");
    expect(availableWindowsFor("2026-10-23", now)).toEqual([]);
    expect(availableWindowsFor("", now)).toEqual([]);
  });

  it("el valor del selector nativo ida y vuelta conserva el día", () => {
    expect(pickerValueToPickupDate(pickupDateToPickerValue("2026-10-24"))).toBe("2026-10-24");
  });
});

describe("offerDayOffsets (DD-060)", () => {
  const now = at("2026-10-24T15:00:00.000Z"); // 12:00 del 24

  it("con la fecha pedida hoy, va de hoy a 3 días después", () => {
    expect(offerDayOffsets("2026-10-24", 3, 3, now)).toEqual([0, 1, 2, 3]);
  });

  it("con la fecha pedida más adelante, empieza hoy", () => {
    expect(offerDayOffsets("2026-10-26", 3, 3, now)).toEqual([-2, -1, 0, 1, 2, 3]);
  });

  it("con la fecha pedida lejana, corta en maxBackwardDays antes de la pedida", () => {
    expect(offerDayOffsets("2026-11-18", 3, 3, now)).toEqual([-3, -2, -1, 0, 1, 2, 3]);
  });

  it("con la fecha pedida ya pasada, empieza hoy y no ofrece días pasados", () => {
    expect(offerDayOffsets("2026-10-22", 3, 3, now)).toEqual([2, 3]);
  });

  it("con la fecha pedida pasada hace más de maxForwardDays, no hay días", () => {
    expect(offerDayOffsets("2026-10-18", 3, 3, now)).toEqual([]);
  });
});

describe("isTimeWindowEnded (DD-060)", () => {
  it("una franja termina a su hora de fin en Argentina", () => {
    expect(isTimeWindowEnded("2026-10-24", "22:00", at("2026-10-25T00:59:00.000Z"))).toBe(false); // 21:59
    expect(isTimeWindowEnded("2026-10-24", "22:00", at("2026-10-25T01:00:00.000Z"))).toBe(true); // 22:00
  });
});
