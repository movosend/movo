import { describe, it, expect } from "vitest";
import { ShipmentStatus } from "@movo/shared";
import { adminTrackingState, averageSpeedKmh, capTrace, trackingMetrics } from "../src/domain/admin-tracking";
import { progressAlongPath } from "../src/domain/geo";

// MOVO-327: cálculos del seguimiento del panel, sin base.
const A = { lat: -31.0, lng: -64.0 };
const B = { lat: -31.0, lng: -63.0 };
const C = { lat: -32.0, lng: -63.0 };

describe("adminTrackingState", () => {
  it("cubre los 11 estados", () => {
    const states = Object.values(ShipmentStatus).map((status) => [status, adminTrackingState(status).state]);
    expect(Object.fromEntries(states)).toEqual({
      awaiting_receiver_confirmation: "no_carrier",
      rejected_by_receiver: "no_carrier",
      published: "no_carrier",
      assignment_pending: "not_started",
      assigned_unfunded: "not_started",
      assigned: "not_started",
      in_transit: "live",
      delivered: "closed",
      completed: "closed",
      cancelled: "closed",
      disputed: "closed",
    });
  });

  it("`live` no lleva motivo", () => {
    expect(adminTrackingState(ShipmentStatus.IN_TRANSIT).reason).toBeNull();
    expect(adminTrackingState(ShipmentStatus.ASSIGNED_UNFUNDED).reason).toBe("unfunded");
  });
});

describe("progressAlongPath", () => {
  it("usa el largo acumulado de la línea, no la recta al destino", () => {
    // A -> B -> C en L: B está al final del primer tramo (~95 km de ~206 km).
    const fraction = progressAlongPath(B, [A, B, C])!;
    expect(fraction).toBeGreaterThan(0.4);
    expect(fraction).toBeLessThan(0.5);
  });

  it("proyecta un punto fuera de la línea sobre el segmento más cercano", () => {
    expect(progressAlongPath({ lat: -30.9, lng: -63.5 }, [A, B])).toBeCloseTo(0.5, 2);
  });

  it("una línea sin largo es `null`", () => {
    expect(progressAlongPath(A, [A])).toBeNull();
  });
});

describe("capTrace", () => {
  it("no toca una traza dentro del tope", () => {
    expect(capTrace([1, 2, 3], 5)).toEqual({ points: [1, 2, 3], truncated: false });
  });

  it("submuestrea conservando el primero y el último", () => {
    const points = Array.from({ length: 1001 }, (_, i) => i);
    const { points: capped, truncated } = capTrace(points, 500);
    expect(truncated).toBe(true);
    expect(capped).toHaveLength(500);
    expect(capped[0]).toBe(0);
    expect(capped[499]).toBe(1000);
  });
});

describe("averageSpeedKmh", () => {
  const until = new Date("2030-01-01T12:05:00.000Z");
  const at = (minutesBefore: number, lng: number) => ({
    lat: -31.0,
    lng,
    capturedAt: new Date(until.getTime() - minutesBefore * 60_000).toISOString(),
  });

  it("promedia solo los puntos de los últimos 5 min", () => {
    // 0,05° de longitud a -31° ≈ 4,76 km en 4 min ≈ 71 km/h; el punto de hace 10 min queda afuera.
    const speed = averageSpeedKmh([at(10, -64.5), at(4, -64.0), at(0, -63.95)], until)!;
    expect(speed).toBeGreaterThan(65);
    expect(speed).toBeLessThan(75);
  });

  it("con menos de 2 puntos en la ventana es `null`", () => {
    expect(averageSpeedKmh([at(10, -64.0), at(0, -63.9)], until)).toBeNull();
  });
});

describe("trackingMetrics", () => {
  const now = new Date("2030-01-01T12:00:00.000Z");
  const route = { path: [A, B], distanceMeters: 100_000, durationSeconds: 4000 };

  it("con ruta: km, % y ETA en proporción a lo que falta de la ruta", () => {
    const metrics = trackingMetrics({ position: { lat: -31.0, lng: -63.75 }, origin: A, destination: B, route, avgSpeedKmh: 5, signalLost: false, now });
    expect(metrics.progressPct).toBeCloseTo(25, 0);
    expect(metrics.remainingMeters).toBeCloseTo(75_000, -3);
    // 75 % de 4000 s, sin importar que la velocidad de 5 min sea baja.
    expect(Date.parse(metrics.etaAt!) - now.getTime()).toBeCloseTo(3000_000, -4);
    expect(metrics.avgSpeedKmh5m).toBe(5);
  });

  it("sin ruta: línea recta a la entrega y ETA con la velocidad promedio", () => {
    const metrics = trackingMetrics({ position: { lat: -31.0, lng: -63.5 }, origin: A, destination: B, route: null, avgSpeedKmh: 60, signalLost: false, now });
    expect(metrics.progressPct).toBeCloseTo(50, 0);
    const remainingKm = metrics.remainingMeters! / 1000;
    expect(Date.parse(metrics.etaAt!) - now.getTime()).toBeCloseTo((remainingKm / 60) * 3_600_000, -4);
  });

  it("sin señal: sin velocidad ni ETA, con km y % sobre la última posición", () => {
    const metrics = trackingMetrics({ position: { lat: -31.0, lng: -63.75 }, origin: A, destination: B, route, avgSpeedKmh: 60, signalLost: true, now });
    expect(metrics).toMatchObject({ avgSpeedKmh5m: null, etaAt: null });
    expect(metrics.progressPct).toBeCloseTo(25, 0);
  });
});
