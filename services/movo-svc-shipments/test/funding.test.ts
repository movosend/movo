import { describe, it, expect } from "vitest";
import {
  farRouteFundingDeadline,
  fundingWindowOpensAt,
  isFundingWindowOpen,
  nearRouteFundingDeadline,
  reminderBucket,
  selectFundingRoute,
} from "../src/domain/funding";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const N = 3;
const now = new Date("2026-10-10T12:00:00.000Z");

describe("selectFundingRoute (MOVO-210, bordes de N)", () => {
  it("retiro exactamente a N días: ruta cercana (dentro de N días es inclusivo)", () => {
    expect(selectFundingRoute(new Date(now.getTime() + N * DAY), now, N)).toBe("near");
  });

  it("retiro a N días menos una hora: ruta cercana", () => {
    expect(selectFundingRoute(new Date(now.getTime() + N * DAY - HOUR), now, N)).toBe("near");
  });

  it("retiro a N días más una hora: ruta lejana", () => {
    expect(selectFundingRoute(new Date(now.getTime() + N * DAY + HOUR), now, N)).toBe("far");
  });

  it("retiro a N días más 1 ms: ruta lejana", () => {
    expect(selectFundingRoute(new Date(now.getTime() + N * DAY + 1), now, N)).toBe("far");
  });

  it("un retiro ya vencido (ventana en curso) toma la ruta cercana", () => {
    expect(selectFundingRoute(new Date(now.getTime() - HOUR), now, N)).toBe("near");
  });
});

describe("plazos de la saga", () => {
  const pickupStart = new Date("2026-10-20T12:00:00.000Z");

  it("la ventana de la ruta lejana abre N días antes del inicio del retiro", () => {
    expect(fundingWindowOpensAt(pickupStart, N).toISOString()).toBe("2026-10-17T12:00:00.000Z");
    expect(isFundingWindowOpen(pickupStart, N, new Date("2026-10-17T11:59:59.999Z"))).toBe(false);
    expect(isFundingWindowOpen(pickupStart, N, new Date("2026-10-17T12:00:00.000Z"))).toBe(true);
  });

  it("la ruta lejana vence a T-24h del inicio del retiro", () => {
    expect(farRouteFundingDeadline(pickupStart, 24).toISOString()).toBe("2026-10-19T12:00:00.000Z");
  });

  it("la ruta cercana vence al aceptar + timeout, con tope en el cierre de la ventana de retiro", () => {
    const acceptedAt = new Date("2026-10-10T12:00:00.000Z");
    const farEnd = new Date("2026-10-10T20:00:00.000Z");
    expect(nearRouteFundingDeadline(acceptedAt, 30, farEnd).toISOString()).toBe("2026-10-10T12:30:00.000Z");
    const soonEnd = new Date("2026-10-10T12:10:00.000Z");
    expect(nearRouteFundingDeadline(acceptedAt, 30, soonEnd).toISOString()).toBe("2026-10-10T12:10:00.000Z");
  });

  it("la cubeta del recordatorio cambia cada `intervalHours` y es estable dentro del intervalo", () => {
    const a = reminderBucket(new Date("2026-10-10T00:00:00.000Z"), 12);
    expect(reminderBucket(new Date("2026-10-10T11:59:00.000Z"), 12)).toBe(a);
    expect(reminderBucket(new Date("2026-10-10T12:00:00.000Z"), 12)).toBe(a + 1);
  });
});
