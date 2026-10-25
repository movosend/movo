import {
  clockTime,
  formatDuration,
  formatDurationSeconds,
  formatRelativeDuration,
  formatTimeOfDay,
  formatTimeRange,
  toHHMM,
} from "../src/lib/time-format";

describe("time-format (MOVO-340)", () => {
  describe("formatTimeOfDay", () => {
    it("agrega la unidad y normaliza los segundos", () => {
      expect(formatTimeOfDay("14:30")).toBe("14:30 h");
      expect(formatTimeOfDay("09:00:00")).toBe("09:00 h");
      expect(formatTimeOfDay("9:05")).toBe("09:05 h");
    });

    it("medianoche es 00:00 h", () => {
      expect(formatTimeOfDay("00:00:00")).toBe("00:00 h");
      expect(formatTimeOfDay(new Date(2026, 9, 24, 0, 0))).toBe("00:00 h");
    });

    it("un instante se muestra en la hora del dispositivo", () => {
      expect(formatTimeOfDay(new Date(2026, 9, 24, 18, 7))).toBe("18:07 h");
    });

    it("un valor inválido no se muestra", () => {
      expect(formatTimeOfDay("")).toBe("");
      expect(formatTimeOfDay(null)).toBe("");
      expect(formatTimeOfDay("mañana")).toBe("");
      expect(formatTimeOfDay(new Date("x"))).toBe("");
    });
  });

  describe("formatTimeRange", () => {
    it("lleva una sola unidad al final", () => {
      expect(formatTimeRange("14:00:00", "16:00:00")).toBe("14:00 a 16:00 h");
    });

    it("un rango que termina a medianoche", () => {
      expect(formatTimeRange("22:00", "00:00")).toBe("22:00 a 00:00 h");
    });

    it("un extremo faltante se muestra como raya", () => {
      expect(formatTimeRange("14:00", "")).toBe("14:00 a — h");
      expect(formatTimeRange("", "")).toBe("");
    });
  });

  describe("formatDuration", () => {
    it.each([
      [0, "0 min"],
      [1, "1 min"],
      [45, "45 min"],
      [59, "59 min"],
      [60, "1 h"],
      [61, "1 h 1 min"],
      [135, "2 h 15 min"],
      [120, "2 h"],
      [24 * 60, "24 h"],
      [26 * 60 + 30, "26 h 30 min"],
      [-5, "0 min"],
    ])("%d min → %s", (minutes, expected) => {
      expect(formatDuration(minutes)).toBe(expected);
    });

    it("a partir de segundos redondea al minuto", () => {
      expect(formatDurationSeconds(29)).toBe("0 min");
      expect(formatDurationSeconds(90)).toBe("2 min");
      expect(formatDurationSeconds(3600)).toBe("1 h");
    });
  });

  it("formatRelativeDuration usa horas enteras después de la hora", () => {
    expect(formatRelativeDuration(0)).toBe("0 min");
    expect(formatRelativeDuration(59.9)).toBe("59 min");
    expect(formatRelativeDuration(60)).toBe("1 h");
    expect(formatRelativeDuration(192)).toBe("3 h");
    expect(formatRelativeDuration(26 * 60)).toBe("26 h");
  });

  it("toHHMM y clockTime no llevan unidad", () => {
    expect(toHHMM("09:00:00")).toBe("09:00");
    expect(clockTime(new Date(2026, 9, 24, 7, 3))).toBe("07:03");
  });
});
