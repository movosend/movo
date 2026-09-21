import { describe, it, expect } from "vitest";
import { haversineKm, HANDSHAKE_MAX_DISTANCE_METERS, distanceToSegmentKm } from "../src/domain/geo";

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

// MOVO-179: port a JS de `haversineSegmentDistanceKm` (`shipment-repository.ts`) para
// el matching inverso envío->viaje -- mismos casos límite que ya cubre esa versión SQL
// (`shipment-repository.integration.test.ts`), en la dirección opuesta.
describe("distanceToSegmentKm", () => {
  it("devuelve 0 para un punto sobre el segmento", () => {
    // Segmento Córdoba (-31.0,-64.0) -> (-31.0,-63.0), punto en el medio exacto.
    const km = distanceToSegmentKm(-31.0, -63.5, -31.0, -64.0, -31.0, -63.0);
    expect(km).toBeCloseTo(0, 6);
  });

  it("caso Oncativo: un punto en el MEDIO de un trayecto largo queda dentro del radio (no clampeado a los extremos)", () => {
    // Mismas coordenadas sintéticas que shipment-repository.integration.test.ts
    // ("con destino: un envío en el MEDIO de un trayecto largo aparece").
    const km = distanceToSegmentKm(-31.0, -63.5, -31.0, -64.0, -31.0, -63.0);
    expect(km).toBeLessThan(10);
    // Control: contra CADA extremo por separado da ~47km -- si esto no clampeara al
    // segmento sino que devolviera la distancia a un extremo, el resultado sería ese
    // valor, muy por fuera del radio.
    expect(haversineKm(-31.0, -63.5, -31.0, -64.0)).toBeGreaterThan(40);
  });

  it("clampea al extremo más cercano para un punto 'antes' del origen", () => {
    // Proyección equirrectangular vs. Haversine real -- misma escala de aproximación
    // (<0.2%) que ya tolera shipment-repository.integration.test.ts para el corredor.
    const beforeOrigin = distanceToSegmentKm(-31.0, -64.5, -31.0, -64.0, -31.0, -63.0);
    const toOrigin = haversineKm(-31.0, -64.5, -31.0, -64.0);
    expect(beforeOrigin).toBeCloseTo(toOrigin, 0);
  });

  it("clampea al extremo más cercano para un punto 'después' del destino", () => {
    const afterDestination = distanceToSegmentKm(-31.0, -62.5, -31.0, -64.0, -31.0, -63.0);
    const toDestination = haversineKm(-31.0, -62.5, -31.0, -63.0);
    expect(afterDestination).toBeCloseTo(toDestination, 0);
  });

  it("mide perpendicular al segmento para un punto fuera de la línea", () => {
    // ~1° de longitud a esta latitud son ~95km -- un punto a 0.1° de latitud del
    // segmento horizontal debería medir bastante menos que eso.
    const km = distanceToSegmentKm(-30.9, -63.5, -31.0, -64.0, -31.0, -63.0);
    expect(km).toBeGreaterThan(0);
    expect(km).toBeLessThan(20);
  });

  it("trayecto degenerado (origen === destino): distancia punto a punto contra el origen", () => {
    const km = distanceToSegmentKm(-31.01, -64.01, -31.0, -64.0, -31.0, -64.0);
    const expected = haversineKm(-31.01, -64.01, -31.0, -64.0);
    expect(km).toBeCloseTo(expected, 1);
  });
});
