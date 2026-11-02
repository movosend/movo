import { describe, expect, it } from "vitest";
import {
  argentinaDayBounds,
  auditTargetKey,
  previousReportRange,
  REPORT_RANGE_MAX_DAYS,
  reportBuckets,
  reportChange,
  reportGranularity,
  reportRangeDays,
  resolveReportRange,
  toOverviewInbox,
  validateReportRange,
} from "../src/types/admin-reports";

// 28/10 a las 12:00 en Argentina.
const NOW = new Date("2026-10-28T15:00:00.000Z");

describe("rango de fechas de los reportes (MOVO-342)", () => {
  describe("validateReportRange", () => {
    it("los extremos son opcionales y no se completan", () => {
      expect(validateReportRange({}, NOW)).toEqual({ ok: true, range: {} });
      expect(validateReportRange({ from: "2000-01-01" }, NOW)).toEqual({ ok: true, range: { from: "2000-01-01" } });
    });

    it("rechaza lo que no es un día real", () => {
      for (const from of ["ayer", "2026-13-01", "2026-02-31", "2026-10-1", "2026-10-01T00:00:00Z"]) {
        expect(validateReportRange({ from }, NOW)).toEqual({ ok: false, reason: "invalid_date" });
      }
    });

    it("un solo día es un rango válido (los extremos son inclusivos); invertido, no", () => {
      expect(validateReportRange({ from: "2026-10-01", to: "2026-10-01" }, NOW).ok).toBe(true);
      expect(validateReportRange({ from: "2026-10-02", to: "2026-10-01" }, NOW)).toEqual({ ok: false, reason: "inverted" });
    });

    it("hoy se mide en hora de Argentina: a las 23:30 del 27 todavía no es 28 aunque en UTC sí", () => {
      const lateNight = new Date("2026-10-28T02:30:00.000Z");
      expect(validateReportRange({ to: "2026-10-27" }, lateNight).ok).toBe(true);
      expect(validateReportRange({ to: "2026-10-28" }, lateNight)).toEqual({ ok: false, reason: "future" });
      expect(validateReportRange({ from: "2026-10-29" }, NOW)).toEqual({ ok: false, reason: "future" });
    });

    it("acepta exactamente el tope y rechaza un día más", () => {
      const atLimit = { from: "2025-10-28", to: "2026-10-28" };
      expect(reportRangeDays(atLimit)).toBe(REPORT_RANGE_MAX_DAYS);
      expect(validateReportRange(atLimit, NOW).ok).toBe(true);
      expect(validateReportRange({ from: "2025-10-27", to: "2026-10-28" }, NOW)).toEqual({ ok: false, reason: "too_long" });
    });
  });

  describe("resolveReportRange", () => {
    it("sin extremos es el largo máximo hasta hoy", () => {
      expect(resolveReportRange({}, NOW)).toEqual({ ok: true, range: { from: "2025-10-28", to: "2026-10-28" } });
    });

    it("sin `from` cuenta hacia atrás desde `to`", () => {
      expect(resolveReportRange({ to: "2026-01-31" }, NOW, 31)).toEqual({ ok: true, range: { from: "2026-01-01", to: "2026-01-31" } });
    });

    it("con un `from` solo, el tope se mide hasta hoy", () => {
      expect(resolveReportRange({ from: "2020-01-01" }, NOW)).toEqual({ ok: false, reason: "too_long" });
      expect(resolveReportRange({ from: "2026-10-01" }, NOW)).toEqual({ ok: true, range: { from: "2026-10-01", to: "2026-10-28" } });
    });
  });

  it("el período anterior tiene el mismo largo y termina justo antes", () => {
    expect(previousReportRange({ from: "2026-10-01", to: "2026-10-31" })).toEqual({ from: "2026-08-31", to: "2026-09-30" });
    expect(previousReportRange({ from: "2026-03-01", to: "2026-03-01" })).toEqual({ from: "2026-02-28", to: "2026-02-28" });
  });

  it("la granularidad: día hasta 31, semana hasta 120, mes el resto", () => {
    expect(reportGranularity({ from: "2026-10-01", to: "2026-10-31" })).toBe("day");
    expect(reportGranularity({ from: "2026-10-01", to: "2026-11-01" })).toBe("week");
    expect(reportGranularity({ from: "2026-01-01", to: "2026-04-30" })).toBe("week");
    expect(reportGranularity({ from: "2026-01-01", to: "2026-05-01" })).toBe("month");
  });

  it("el día de Argentina arranca a las 03:00 UTC", () => {
    expect(argentinaDayBounds("2026-10-28")).toEqual({
      start: new Date("2026-10-28T03:00:00.000Z"),
      end: new Date("2026-10-29T03:00:00.000Z"),
    });
  });
});

describe("bandejas de la home (MOVO-342)", () => {
  const source = { count: 2, yesterdayCount: null, breakdown: [], oldestAt: "2026-10-28T14:00:00.000Z" };

  it("está fuera de plazo solo si lo más viejo pasó las horas de la bandeja", () => {
    expect(toOverviewInbox("support", source, NOW)).toMatchObject({ slaHours: 0.5, overSla: true });
    expect(toOverviewInbox("disputes", source, NOW)).toMatchObject({ slaHours: 72, overSla: false });
  });

  it("sin pendientes o sin plazo nunca está fuera de plazo", () => {
    expect(toOverviewInbox("support", { ...source, oldestAt: null }, NOW).overSla).toBe(false);
    expect(toOverviewInbox("sanctionsEndingToday", { ...source, oldestAt: "2020-01-01T00:00:00.000Z" }, NOW)).toMatchObject({
      slaHours: null,
      overSla: false,
    });
  });

  it("el `overSla` del servicio dueño pisa la cuenta por antigüedad (un hold se pasa antes de vencer)", () => {
    const hold = { ...source, oldestAt: "2026-10-28T14:50:00.000Z", holdsExpiringToday: 1, overSla: true };
    expect(toOverviewInbox("payments", hold, NOW).overSla).toBe(true);
  });

  it("la clave de un objetivo es tipo:id", () => {
    expect(auditTargetKey("dispute", "abc")).toBe("dispute:abc");
  });
});

describe("buckets y variación de los reportes (MOVO-344)", () => {
  it("hasta 31 días, un bucket por día, y el anterior corrido un período completo", () => {
    expect(reportBuckets({ from: "2026-10-01", to: "2026-10-03" })).toEqual([
      { from: "2026-10-01", to: "2026-10-01", previous: { from: "2026-09-28", to: "2026-09-28" } },
      { from: "2026-10-02", to: "2026-10-02", previous: { from: "2026-09-29", to: "2026-09-29" } },
      { from: "2026-10-03", to: "2026-10-03", previous: { from: "2026-09-30", to: "2026-09-30" } },
    ]);
  });

  it("hasta 120 días, semanas contadas desde el inicio y la última recortada", () => {
    const buckets = reportBuckets({ from: "2026-08-01", to: "2026-09-10" });
    expect(buckets).toHaveLength(6);
    expect(buckets[0]).toMatchObject({ from: "2026-08-01", to: "2026-08-07" });
    expect(buckets[5]).toMatchObject({ from: "2026-09-05", to: "2026-09-10" });
  });

  it("más largo, meses de calendario recortados al rango, sin huecos ni solapes", () => {
    const buckets = reportBuckets({ from: "2026-01-15", to: "2026-06-10" });
    expect(buckets.map(({ from, to }) => [from, to])).toEqual([
      ["2026-01-15", "2026-01-31"],
      ["2026-02-01", "2026-02-28"],
      ["2026-03-01", "2026-03-31"],
      ["2026-04-01", "2026-04-30"],
      ["2026-05-01", "2026-05-31"],
      ["2026-06-01", "2026-06-10"],
    ]);
  });

  it("en un porcentaje la variación va en puntos; en el resto, en %", () => {
    expect(reportChange({ value: 12.5, previous: 10 }, true)).toBe(2.5);
    expect(reportChange({ value: 15, previous: 10 }, false)).toBe(50);
  });

  it("sin dato o sin base no hay variación", () => {
    expect(reportChange({ value: null, previous: 10 }, false)).toBeNull();
    expect(reportChange({ value: 10, previous: null }, true)).toBeNull();
    expect(reportChange({ value: 10, previous: 0 }, false)).toBeNull();
    expect(reportChange({ value: 10, previous: 0 }, true)).toBe(10);
  });
});
