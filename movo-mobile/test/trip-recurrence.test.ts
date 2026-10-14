import {
  WEEKDAY_CHIPS,
  formatRecurrenceBadge,
  fromUntilDateString,
  newTripsBannerMessage,
  recurrencePreview,
  toUntilDateString,
  withFixedDay,
} from "../src/lib/trip-recurrence";

// Viernes 2/10/2026 08:00 en Argentina (UTC-3).
const FRIDAY_8AM = new Date("2026-10-02T11:00:00.000Z");

describe("trip-recurrence (MOVO-266)", () => {
  it("los chips arrancan en lunes pero mapean a la convención de @movo/shared (0 = domingo)", () => {
    expect(WEEKDAY_CHIPS.map((chip) => chip.label)).toEqual(["L", "M", "M", "J", "V", "S", "D"]);
    expect(WEEKDAY_CHIPS.map((chip) => chip.value)).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });

  it.each([
    [[5], "Todos los viernes"],
    [[6], "Todos los sábados"],
    [[5, 1], "Lun y vie"],
    [[0, 5, 3, 1], "Lun, mié, vie y dom"],
    [[1, 3, 5], "Lun, mié y vie"],
  ])("badge de %j: %s", (weekdays, expected) => {
    expect(formatRecurrenceBadge(weekdays)).toBe(expected);
  });

  it("preview con un día", () => {
    expect(recurrencePreview({ departureAt: FRIDAY_8AM, weekdays: [5], until: null })).toBe(
      "Cuando salgas el vie 2/10, declaramos automáticamente tu próximo viaje (todos los viernes a las 08:00).",
    );
  });

  it("preview con varios días", () => {
    const text = recurrencePreview({ departureAt: FRIDAY_8AM, weekdays: [5, 1], until: null });
    expect(text).toContain("(los lunes y viernes a las 08:00)");
  });

  it("con una fecha de fin que no deja otra salida, lo avisa en vez de prometer el próximo viaje", () => {
    expect(recurrencePreview({ departureAt: FRIDAY_8AM, weekdays: [5], until: "2026-10-05" })).toBe(
      "Con esa fecha de fin no declaramos ningún viaje después del vie 2/10.",
    );
  });

  it("withFixedDay saca el día fijo anterior y suma el nuevo, sin tocar los elegidos", () => {
    expect(withFixedDay([1, 5], 5, 3)).toEqual([1, 3]);
    expect(withFixedDay([5], 5, 5)).toEqual([5]);
    expect(withFixedDay([], 2, 2)).toEqual([2]);
  });

  it("recurrenceUntil va y vuelve como YYYY-MM-DD del calendario del dispositivo", () => {
    const date = fromUntilDateString("2026-12-18");
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(11);
    expect(date.getDate()).toBe(18);
    expect(toUntilDateString(date)).toBe("2026-12-18");
  });

  describe("newTripsBannerMessage", () => {
    const generated = {
      departureAt: "2026-10-10T11:00:00.000Z",
      destinationAddress: "Bv. España 300, Villa María",
      generatedFromTripId: "trip-0",
    };
    const autoCreated = { ...generated, generatedFromTripId: null };

    it("una ocurrencia generada nombra el día y el destino", () => {
      expect(newTripsBannerMessage([generated])).toBe("Declaramos tu viaje del sáb 10/10 a Bv. España 300");
    });

    it("varias generadas, mezcla y solo auto-creados", () => {
      expect(newTripsBannerMessage([generated, generated])).toBe("Declaramos tus próximos viajes que se repiten");
      expect(newTripsBannerMessage([generated, autoCreated])).toBe("Tenés viajes nuevos en Próximos");
      expect(newTripsBannerMessage([autoCreated])).toBe("Se armó un viaje con un envío que aceptaste");
      expect(newTripsBannerMessage([])).toBeNull();
    });
  });
});
