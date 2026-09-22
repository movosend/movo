import { describe, expect, it } from "vitest";
import { isValidTimeOfDay, isWithinQuietHours } from "../src/config/quiet-hours";

describe("isValidTimeOfDay", () => {
  it("acepta HH:MM válido", () => {
    expect(isValidTimeOfDay("00:00")).toBe(true);
    expect(isValidTimeOfDay("23:59")).toBe(true);
    expect(isValidTimeOfDay("08:30")).toBe(true);
  });

  it("rechaza formatos inválidos", () => {
    expect(isValidTimeOfDay("24:00")).toBe(false);
    expect(isValidTimeOfDay("8:30")).toBe(false);
    expect(isValidTimeOfDay("08:60")).toBe(false);
    expect(isValidTimeOfDay("")).toBe(false);
  });
});

describe("isWithinQuietHours", () => {
  it("franja normal dentro del mismo día", () => {
    expect(isWithinQuietHours("14:00", "13:00", "15:00")).toBe(true);
    expect(isWithinQuietHours("12:59", "13:00", "15:00")).toBe(false);
    expect(isWithinQuietHours("15:00", "13:00", "15:00")).toBe(false); // límite exclusivo
  });

  it("franja que cruza medianoche", () => {
    expect(isWithinQuietHours("23:30", "23:00", "08:00")).toBe(true);
    expect(isWithinQuietHours("02:00", "23:00", "08:00")).toBe(true);
    expect(isWithinQuietHours("08:00", "23:00", "08:00")).toBe(false); // límite exclusivo
    expect(isWithinQuietHours("12:00", "23:00", "08:00")).toBe(false);
  });

  it("from === to se interpreta como silencio las 24hs", () => {
    expect(isWithinQuietHours("00:00", "10:00", "10:00")).toBe(true);
    expect(isWithinQuietHours("23:59", "10:00", "10:00")).toBe(true);
  });
});
