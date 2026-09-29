import { formatReportTimestamp } from "../src/lib/report-format";

/** MOVO-256: fechas del historial del reporte (mockup 1A), en hora local. */
describe("formatReportTimestamp", () => {
  const now = new Date(2026, 8, 26, 18, 54);

  it("hoy muestra la hora", () => {
    expect(formatReportTimestamp(new Date(2026, 8, 26, 9, 5).toISOString(), now)).toBe("Hoy 09:05");
  });

  it("este año muestra día y mes abreviado", () => {
    expect(formatReportTimestamp(new Date(2026, 8, 20, 15, 0).toISOString(), now)).toBe("20 sept");
    expect(formatReportTimestamp(new Date(2026, 0, 3, 15, 0).toISOString(), now)).toBe("3 ene");
  });

  it("otro año suma el año", () => {
    expect(formatReportTimestamp(new Date(2025, 11, 31, 23, 0).toISOString(), now)).toBe("31 dic 2025");
  });
});
