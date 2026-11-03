import { describe, it, expect } from "vitest";
import {
  farRouteFundingDeadline,
  fundingWindowOpensAt,
  isFundingWindowOpen,
  nearRouteFundingDeadline,
  providerFailureFundingExtension,
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

describe("extensión del plazo por falla del proveedor (DD-057)", () => {
  const MIN = 60 * 1000;
  const acceptedAt = new Date("2026-10-25T20:40:00.000Z");
  const base = new Date(acceptedAt.getTime() + 30 * MIN);
  const pickupEnd = new Date("2026-10-25T23:00:00.000Z");
  const extend = (attemptMin: number, extra: Partial<Parameters<typeof providerFailureFundingExtension>[0]> = {}) =>
    providerFailureFundingExtension({
      attemptAt: new Date(acceptedAt.getTime() + attemptMin * MIN),
      currentDeadline: base,
      pickupEnd,
      extensionsSoFar: 0,
      extensionMinutes: 15,
      maxExtensions: 2,
      ...extra,
    });

  it("el caso de la prueba del 25/10: un intento a los 19 min alarga el plazo de 21:10 a 21:14", () => {
    expect(extend(19)?.toISOString()).toBe("2026-10-25T21:14:00.000Z");
  });

  it("no acorta el plazo: un intento temprano no extiende", () => {
    expect(extend(5)).toBeNull();
  });

  it("respeta el tope de extensiones", () => {
    expect(extend(25, { extensionsSoFar: 2 })).toBeNull();
  });

  it("nunca pasa el cierre de la ventana de retiro", () => {
    const soonEnd = new Date(acceptedAt.getTime() + 35 * MIN);
    expect(extend(25, { pickupEnd: soonEnd })?.toISOString()).toBe(soonEnd.toISOString());
  });
});
