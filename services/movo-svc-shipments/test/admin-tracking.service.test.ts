import { describe, it, expect, vi } from "vitest";
import { ShipmentStatus, TripStatus } from "@movo/shared";
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

function build(opts: {
  trip: boolean;
  hash?: Record<string, string>;
  tripStatus?: TripStatus;
  approach?: typeof route | null;
  pendingPickupShipmentIds?: string[];
}) {
  const findTrackingContext = vi
    .fn()
    .mockResolvedValue({
      shipment: {},
      trip: opts.trip ? { id: "t1", status: opts.tripStatus ?? TripStatus.ACTIVE } : null,
      pendingPickupShipmentIds: opts.pendingPickupShipmentIds,
    });
  const get = vi.fn().mockResolvedValue(route);
  const approachGet = vi.fn().mockResolvedValue(opts.approach === undefined ? route : opts.approach);
  const service = createAdminTrackingService({
    shipmentRepository: { findTrackingContext },
    positionRepository: { listCustodyTrace: vi.fn().mockResolvedValue([]) },
    redis: { hgetall: vi.fn().mockResolvedValue(opts.hash ?? {}) },
    routeStore: { get },
    approachRouteStore: { get: approachGet },
    signalLostSeconds: 90,
    now: () => NOW,
  });
  return { service, findTrackingContext, get, approachGet };
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

  // MOVO-359: el tramo del transportista al retiro, antes del retiro.
  describe("approachRoute", () => {
    const fresh = { lat: "-31.5", lng: "-64.1", capturedAt: NOW.toISOString(), recordedAt: NOW.toISOString() };

    it("`assigned` con el viaje activo y posición reciente: pide la ruta de la posición al retiro", async () => {
      const { service, approachGet } = build({ trip: true, hash: fresh });
      const result = await service.get(row(ShipmentStatus.ASSIGNED), { approachRoute: true });
      expect(approachGet).toHaveBeenCalledWith("s1", { lat: -31.5, lng: -64.1 }, expect.objectContaining({ lat: -31.4, lng: -64.2 }));
      expect(result.approachRoute).toEqual(route);
    });

    it("con otro retiro pendiente en el mismo viaje no se pide y el campo va ausente (el móvil no conserva una línea anterior)", async () => {
      const { service, approachGet } = build({ trip: true, hash: fresh, pendingPickupShipmentIds: ["s1", "s2"] });
      const result = await service.get(row(ShipmentStatus.ASSIGNED), { approachRoute: true });
      expect(approachGet).not.toHaveBeenCalled();
      expect("approachRoute" in result).toBe(false);
    });

    it("si el único retiro pendiente es el de este envío, se pide", async () => {
      const { service, approachGet } = build({ trip: true, hash: fresh, pendingPickupShipmentIds: ["s1"] });
      await service.get(row(ShipmentStatus.ASSIGNED), { approachRoute: true });
      expect(approachGet).toHaveBeenCalledTimes(1);
    });

    it("la ruta al retiro se pide en paralelo con la planificada, no después", async () => {
      const order: string[] = [];
      const gate = <T,>(label: string, value: T) =>
        vi.fn(async () => {
          order.push(`${label}:start`);
          await new Promise((r) => setTimeout(r, 5));
          order.push(`${label}:end`);
          return value;
        });
      const service = createAdminTrackingService({
        shipmentRepository: {
          findTrackingContext: vi.fn().mockResolvedValue({ shipment: {}, trip: { id: "t1", status: TripStatus.ACTIVE } }),
        },
        positionRepository: { listCustodyTrace: vi.fn().mockResolvedValue([]) },
        redis: { hgetall: vi.fn().mockResolvedValue(fresh) },
        routeStore: { get: gate("planned", route) },
        approachRouteStore: { get: gate("approach", route) },
        signalLostSeconds: 90,
        now: () => NOW,
      });
      await service.get(row(ShipmentStatus.ASSIGNED), { approachRoute: true });
      expect(order.indexOf("approach:start")).toBeLessThan(order.indexOf("planned:end"));
    });

    it("el panel no la pide: ni llama al proveedor ni suma el campo", async () => {
      const { service, approachGet } = build({ trip: true, hash: fresh });
      const result = await service.get(row(ShipmentStatus.ASSIGNED));
      expect(approachGet).not.toHaveBeenCalled();
      expect("approachRoute" in result).toBe(false);
    });

    it("en tránsito ya no hay tramo al retiro", async () => {
      const { service, approachGet } = build({ trip: true, hash: fresh });
      const result = await service.get(row(ShipmentStatus.IN_TRANSIT), { approachRoute: true });
      expect(approachGet).not.toHaveBeenCalled();
      expect("approachRoute" in result).toBe(false);
    });

    it("con el viaje sin iniciar o sin transportista no hay posición de dónde partir", async () => {
      const declared = build({ trip: true, hash: fresh, tripStatus: TripStatus.DECLARED });
      expect("approachRoute" in (await declared.service.get(row(ShipmentStatus.ASSIGNED), { approachRoute: true }))).toBe(false);
      expect(declared.approachGet).not.toHaveBeenCalled();

      const noTrip = build({ trip: false });
      expect("approachRoute" in (await noTrip.service.get(row(ShipmentStatus.ASSIGNED), { approachRoute: true }))).toBe(false);
      expect(noTrip.approachGet).not.toHaveBeenCalled();
    });

    it("sin señal reciente no la arma: saldría de un lugar donde el auto ya no está", async () => {
      const old = new Date(NOW.getTime() - 10 * 60 * 1000).toISOString();
      const { service, approachGet } = build({ trip: true, hash: { lat: "-31.5", lng: "-64.1", capturedAt: old, recordedAt: old } });
      const result = await service.get(row(ShipmentStatus.ASSIGNED), { approachRoute: true });
      expect(approachGet).not.toHaveBeenCalled();
      expect(result.approachRoute).toBeNull();
    });

    it("si el proveedor falla sale `null` y el seguimiento sigue con el resto", async () => {
      const { service } = build({ trip: true, hash: fresh, approach: null });
      const result = await service.get(row(ShipmentStatus.ASSIGNED), { approachRoute: true });
      expect(result.approachRoute).toBeNull();
      expect(result.plannedRoute).toEqual(route);
    });
  });
});
