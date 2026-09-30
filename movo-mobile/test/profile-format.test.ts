import {
  capitalizeName,
  formatGreetingDateLabel,
  formatMemberSince,
  formatReputationScore,
  formatShipmentCount,
  formatTripCount,
  getFirstName,
  getInitials,
} from "../src/lib/profile-format";

// MOVO-78 AC10: los contadores/score en cero (o sin dato) nunca se renderizan como
// `null`/`undefined`/`NaN` — es el estado exacto en el que va a estar la Sprint
// Review, sin envíos ni ratings todavía.
describe("profile-format", () => {
  describe("formatShipmentCount", () => {
    it.each([
      [0, "Sin envíos aún"],
      [null, "Sin envíos aún"],
      [undefined, "Sin envíos aún"],
      [NaN, "Sin envíos aún"],
      [1, "1 envío"],
      [3, "3 envíos"],
    ])("formatShipmentCount(%p) === %p", (input, expected) => {
      expect(formatShipmentCount(input)).toBe(expected);
    });
  });

  describe("formatGreetingDateLabel", () => {
    it("formatea el día en mayúsculas, sin año, estilo eyebrow del header de Inicio", () => {
      // Lunes 8 de septiembre de 2025 (UTC-3, dentro del mismo día en Argentina).
      const date = new Date("2025-09-08T12:00:00-03:00");

      expect(formatGreetingDateLabel(date)).toBe("LUNES, 8 DE SEPTIEMBRE");
    });
  });

  describe("formatTripCount", () => {
    it.each([
      [0, "Sin viajes aún"],
      [null, "Sin viajes aún"],
      [undefined, "Sin viajes aún"],
      [NaN, "Sin viajes aún"],
      [1, "1 viaje"],
      [5, "5 viajes"],
    ])("formatTripCount(%p) === %p", (input, expected) => {
      expect(formatTripCount(input)).toBe(expected);
    });
  });

  describe("formatReputationScore", () => {
    it.each([
      [null, "Sin calificaciones"],
      [undefined, "Sin calificaciones"],
      [NaN, "Sin calificaciones"],
      [0, "0.0"],
      [4.567, "4.6"],
      [5, "5.0"],
    ])("formatReputationScore(%p) === %p", (input, expected) => {
      expect(formatReputationScore(input)).toBe(expected);
    });
  });

  describe("getInitials", () => {
    it.each([
      [null, "?"],
      [undefined, "?"],
      ["", "?"],
      ["   ", "?"],
      ["Martina", "M"],
      ["Martina Zurita", "MZ"],
      ["  martina   zurita  ", "MZ"],
      ["Martina Zurita Gomez", "MG"],
    ])("getInitials(%p) === %p", (input, expected) => {
      expect(getInitials(input)).toBe(expected);
    });
  });

  describe("getFirstName", () => {
    it.each([
      [null, ""],
      [undefined, ""],
      ["", ""],
      ["   ", ""],
      ["Martina", "Martina"],
      ["Martina Zurita", "Martina"],
      // Capitaliza el resultado (MOVO-83, feedback de UI) — nunca se confía en cómo
      // quedó guardado el nombre.
      ["  martina   zurita  ", "Martina"],
      ["MARTINA", "Martina"],
      ["Martina Zurita Gomez", "Martina"],
    ])("getFirstName(%p) === %p", (input, expected) => {
      expect(getFirstName(input)).toBe(expected);
    });
  });

  describe("capitalizeName", () => {
    it.each([
      [null, ""],
      [undefined, ""],
      ["", ""],
      ["   ", ""],
      ["martina zurita", "Martina Zurita"],
      ["MARTINA ZURITA", "Martina Zurita"],
      ["MaRtInA zUrItA", "Martina Zurita"],
      ["  martina   zurita  ", "Martina Zurita"],
      ["josé maría pérez", "José María Pérez"],
      ["ana-maria lópez", "Ana-Maria López"],
    ])("capitalizeName(%p) === %p", (input, expected) => {
      expect(capitalizeName(input)).toBe(expected);
    });
  });
});

describe("formatMemberSince", () => {
  const now = new Date(2026, 8, 28, 15, 0); // 28/09/2026, hora local

  it("el mismo día es 'desde hoy'", () => {
    expect(formatMemberSince(new Date(2026, 8, 28, 9, 0).toISOString(), now)).toBe("Miembro desde hoy");
  });

  it("cuenta días en singular y plural", () => {
    expect(formatMemberSince(new Date(2026, 8, 27, 12, 0).toISOString(), now)).toBe("Miembro desde hace 1 día");
    expect(formatMemberSince(new Date(2026, 8, 3, 12, 0).toISOString(), now)).toBe("Miembro desde hace 25 días");
  });

  it("cuenta meses por calendario", () => {
    expect(formatMemberSince(new Date(2026, 7, 28, 12, 0).toISOString(), now)).toBe("Miembro desde hace 1 mes");
    expect(formatMemberSince(new Date(2026, 3, 10, 12, 0).toISOString(), now)).toBe("Miembro desde hace 5 meses");
  });

  it("un año cumplido es '1 año', no '12 meses'", () => {
    expect(formatMemberSince(new Date(2025, 8, 28, 12, 0).toISOString(), now)).toBe("Miembro desde hace 1 año");
    expect(formatMemberSince(new Date(2023, 1, 1, 12, 0).toISOString(), now)).toBe("Miembro desde hace 3 años");
  });

  it("un mes que todavía no se cumplió sigue contando en días", () => {
    expect(formatMemberSince(new Date(2026, 7, 29, 12, 0).toISOString(), now)).toBe("Miembro desde hace 30 días");
  });

  it("sin fecha o con una fecha inválida no muestra nada", () => {
    expect(formatMemberSince(null, now)).toBeNull();
    expect(formatMemberSince("no-es-una-fecha", now)).toBeNull();
  });
});
