import {
  availableWindowsFor,
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

  it("una franja que empieza justo ahora todavía se puede elegir; un minuto después no", () => {
    expect(availableWindowsFor("2026-10-24", at("2026-10-24T21:00:00.000Z")).map((w) => w.start)).toEqual(["18:00"]);
    expect(availableWindowsFor("2026-10-24", at("2026-10-24T21:01:00.000Z"))).toEqual([]);
  });

  it("sin franjas que queden hoy, el default es mañana", () => {
    const now = at("2026-10-24T22:00:00.000Z"); // 19:00
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
