import { describe, expect, it } from "vitest";
import { canStartTripOn, tripStartAvailableOn } from "../src/config/trip-start";

describe("canStartTripOn", () => {
  it("no permite iniciar antes del día de salida", () => {
    // Salida 2026-10-10 10:00 AR, ahora 2026-10-08 12:00 AR.
    expect(canStartTripOn("2026-10-10T13:00:00.000Z", new Date("2026-10-08T15:00:00.000Z"))).toBe(false);
  });

  it("permite iniciar el día de salida a cualquier hora, incluso antes de la hora declarada", () => {
    // Salida 2026-10-08 18:00 AR, ahora 2026-10-08 00:05 AR.
    expect(canStartTripOn("2026-10-08T21:00:00.000Z", new Date("2026-10-08T03:05:00.000Z"))).toBe(true);
  });

  it("no permite iniciar un viaje que sale mañana", () => {
    // Salida 2026-10-09 10:00 AR, ahora 2026-10-08 12:00 AR.
    expect(canStartTripOn("2026-10-09T13:00:00.000Z", new Date("2026-10-08T15:00:00.000Z"))).toBe(false);
  });

  it("permite iniciar después de la salida", () => {
    expect(canStartTripOn("2026-10-05T13:00:00.000Z", new Date("2026-10-08T15:00:00.000Z"))).toBe(true);
  });

  it("salida a las 23:30 AR (02:30 UTC del día siguiente) se puede iniciar a las 23:00 AR de ese día", () => {
    // Salida 2026-10-08 23:30 AR = 2026-10-09T02:30Z; ahora 2026-10-08 23:00 AR = 2026-10-09T02:00Z.
    expect(canStartTripOn("2026-10-09T02:30:00.000Z", new Date("2026-10-09T02:00:00.000Z"))).toBe(true);
  });

  it("salida a las 00:30 AR del día siguiente no se puede iniciar a las 23:59 AR del día anterior", () => {
    // Salida 2026-10-09 00:30 AR = 2026-10-09T03:30Z; ahora 2026-10-08 23:59 AR = 2026-10-09T02:59Z.
    expect(canStartTripOn("2026-10-09T03:30:00.000Z", new Date("2026-10-09T02:59:00.000Z"))).toBe(false);
  });

  it("acepta Date como salida", () => {
    expect(canStartTripOn(new Date("2026-10-08T13:00:00.000Z"), new Date("2026-10-08T13:00:00.000Z"))).toBe(true);
  });
});

describe("tripStartAvailableOn", () => {
  it("devuelve el día de salida en calendario argentino", () => {
    expect(tripStartAvailableOn("2026-10-09T02:30:00.000Z")).toBe("2026-10-08");
  });
});
