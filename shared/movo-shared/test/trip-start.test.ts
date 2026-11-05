import { describe, expect, it } from "vitest";
import { canStartTripOn, tripStartAvailableOn } from "../src/config/trip-start";

describe("canStartTripOn", () => {
  it("permite iniciar hasta 3 días calendario antes de la salida (DD-060)", () => {
    // Salida 2026-10-11 10:00 AR, ahora 2026-10-08 12:00 AR.
    expect(canStartTripOn("2026-10-11T13:00:00.000Z", new Date("2026-10-08T15:00:00.000Z"))).toBe(true);
  });

  it("no permite iniciar a 4 días de la salida", () => {
    // Salida 2026-10-12 10:00 AR, ahora 2026-10-08 12:00 AR.
    expect(canStartTripOn("2026-10-12T13:00:00.000Z", new Date("2026-10-08T15:00:00.000Z"))).toBe(false);
  });

  it("permite iniciar el día de salida a cualquier hora, incluso antes de la hora declarada", () => {
    // Salida 2026-10-08 18:00 AR, ahora 2026-10-08 00:05 AR.
    expect(canStartTripOn("2026-10-08T21:00:00.000Z", new Date("2026-10-08T03:05:00.000Z"))).toBe(true);
  });

  it("permite iniciar después de la salida", () => {
    expect(canStartTripOn("2026-10-05T13:00:00.000Z", new Date("2026-10-08T15:00:00.000Z"))).toBe(true);
  });

  it("cuenta días argentinos, no UTC: el corte es a las 00:00 AR", () => {
    // Salida 2026-10-12 00:30 AR = 2026-10-12T03:30Z. Primer día habilitado: 2026-10-09 AR.
    // 2026-10-08 23:59 AR = 2026-10-09T02:59Z: todavía no.
    expect(canStartTripOn("2026-10-12T03:30:00.000Z", new Date("2026-10-09T02:59:00.000Z"))).toBe(false);
    // 2026-10-09 00:01 AR = 2026-10-09T03:01Z: ya sí.
    expect(canStartTripOn("2026-10-12T03:30:00.000Z", new Date("2026-10-09T03:01:00.000Z"))).toBe(true);
  });

  it("acepta Date como salida", () => {
    expect(canStartTripOn(new Date("2026-10-08T13:00:00.000Z"), new Date("2026-10-08T13:00:00.000Z"))).toBe(true);
  });
});

describe("tripStartAvailableOn", () => {
  it("devuelve 3 días antes de la salida, en calendario argentino", () => {
    // Salida 2026-10-08 23:30 AR.
    expect(tripStartAvailableOn("2026-10-09T02:30:00.000Z")).toBe("2026-10-05");
  });

  it("cruza el cambio de mes", () => {
    expect(tripStartAvailableOn("2026-11-02T13:00:00.000Z")).toBe("2026-10-30");
  });
});
