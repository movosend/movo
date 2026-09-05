import { describe, it, expect } from "vitest";
import { haversineKm, HANDSHAKE_MAX_DISTANCE_METERS } from "../src/domain/geo";

describe("haversineKm", () => {
  it("devuelve 0 para el mismo punto", () => {
    expect(haversineKm(-31.4201, -64.1888, -31.4201, -64.1888)).toBe(0);
  });

  it("calcula ~1.57km entre dos puntos conocidos de Córdoba", () => {
    // Plaza San Martín (-31.4201, -64.1888) a Nueva Córdoba (-31.4353, -64.1858)
    const km = haversineKm(-31.4201, -64.1888, -31.4353, -64.1858);
    expect(km).toBeGreaterThan(1.6);
    expect(km).toBeLessThan(1.8);
  });

  it("es simétrica", () => {
    const a = haversineKm(-31.42, -64.18, -31.5, -64.2);
    const b = haversineKm(-31.5, -64.2, -31.42, -64.18);
    expect(a).toBeCloseTo(b, 10);
  });
});

describe("HANDSHAKE_MAX_DISTANCE_METERS", () => {
  it("es 100 (AC4 de MOVO-158)", () => {
    expect(HANDSHAKE_MAX_DISTANCE_METERS).toBe(100);
  });
});
