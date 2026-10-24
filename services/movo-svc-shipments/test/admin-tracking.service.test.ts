import { describe, it, expect, vi } from "vitest";
import { ShipmentStatus } from "@movo/shared";
import { createAdminTrackingService } from "../src/modules/admin-internal/admin-tracking.service";

// MOVO-327 (review PR-304): el servicio con fakes, sin base ni Redis.
const NOW = new Date("2026-10-24T12:00:00Z");
const route = { polyline: "abc", distanceMeters: 1000, durationSeconds: 60 };
const num = (n: number) => ({ toNumber: () => n });

function row(status: ShipmentStatus) {
  return {
    id: "s1",
    status,
    pickupLat: num(-31.4),
    pickupLng: num(-64.2),
    pickupCity: "Córdoba",
    pickupAddress: "x",
    deliveryLat: num(-32.4),
    deliveryLng: num(-63.2),
    deliveryCity: "Rosario",
    deliveryAddress: "y",
    transitAnomalyFlaggedAt: null,
  } as never;
}

function build(opts: { trip: boolean; hash?: Record<string, string> }) {
  const findTrackingContext = vi.fn().mockResolvedValue({ shipment: {}, trip: opts.trip ? { id: "t1" } : null });
  const get = vi.fn().mockResolvedValue(route);
  const service = createAdminTrackingService({
    shipmentRepository: { findTrackingContext },
    positionRepository: { listCustodyTrace: vi.fn().mockResolvedValue([]) },
    redis: { hgetall: vi.fn().mockResolvedValue(opts.hash ?? {}) },
    routeStore: { get },
    signalLostSeconds: 90,
    now: () => NOW,
  });
  return { service, findTrackingContext, get };
}

describe("admin-tracking.service", () => {
  it("un envío cerrado sin transportista no pide la ruta y devuelve `plannedRoute` nula", async () => {
    const { service, get } = build({ trip: false });
    const result = await service.get(row(ShipmentStatus.CANCELLED));
    expect(get).not.toHaveBeenCalled();
    expect(result.plannedRoute).toBeNull();
  });

  it("resuelve el contexto una sola vez por tick", async () => {
    const hash = { lat: "-31.5", lng: "-64.1", capturedAt: NOW.toISOString(), recordedAt: NOW.toISOString() };
    const { service, findTrackingContext } = build({ trip: true, hash });
    await service.get(row(ShipmentStatus.IN_TRANSIT));
    expect(findTrackingContext).toHaveBeenCalledTimes(1);
  });

  it("sin `recordedAt` en Redis mide la antigüedad con `capturedAt` y marca la señal perdida", async () => {
    const old = new Date(NOW.getTime() - 10 * 60 * 1000).toISOString();
    const { service } = build({ trip: true, hash: { lat: "-31.5", lng: "-64.1", capturedAt: old } });
    const result = await service.get(row(ShipmentStatus.IN_TRANSIT));
    expect(result.signalLost).toBe(true);
    expect(result.lastPingAt).toBe(old);
  });
});
