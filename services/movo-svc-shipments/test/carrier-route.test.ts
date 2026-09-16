import { describe, it, expect } from "vitest";
import { ShipmentStatus } from "@movo/shared";
import {
  aggregateCarrierStops,
  buildDegradedRoute,
  buildEmptyRoute,
  formatPickupInstant,
  mapOptimizedRoute,
} from "../src/domain/carrier-route";
import { Shipment } from "../src/models/shipment";

function createMockShipment(overrides: Partial<Shipment> = {}): Shipment {
  return {
    id: "shipment-1",
    senderId: "sender-1",
    receiverId: "receiver-1",
    carrierId: "carrier-1",
    packageType: "standard_package",
    weightKg: 2.5,
    lengthCm: 20,
    widthCm: 15,
    heightCm: 10,
    description: "Caja de libros",
    urgent: false,
    pickupAddress: "Av. Colón 123",
    pickupLat: -31.4167,
    pickupLng: -64.1833,
    deliveryAddress: "San Martín 456",
    deliveryLat: -31.425,
    deliveryLng: -64.19,
    pickupDate: new Date("2026-09-15T00:00:00.000Z"),
    pickupTimeWindowStart: new Date("1970-01-01T09:00:00.000Z"),
    pickupTimeWindowEnd: new Date("1970-01-01T12:00:00.000Z"),
    suggestedPriceArs: 1500,
    calculationMethod: "euclidean_linear_v1",
    agreedPriceArs: 1500,
    paymentMethod: null,
    status: ShipmentStatus.ASSIGNED,
    lastStatusChangedAt: new Date("2026-09-14T10:00:00.000Z"),
    deliveredAt: null,
    receiverConfirmationDeadline: null,
    createdAt: new Date("2026-09-14T09:00:00.000Z"),
    updatedAt: new Date("2026-09-14T10:00:00.000Z"),
    estimatedDeliveryDate: new Date("2026-09-15T00:00:00.000Z"),
    estimatedDeliveryTimeWindowStart: "14:00",
    estimatedDeliveryTimeWindowEnd: "18:00",
    ...overrides,
  };
}

describe("Domain: Carrier Route (MOVO-206)", () => {
  describe("formatPickupInstant", () => {
    it("combina fecha de retiro y hora UTC sumando el offset argentino (UTC-3)", () => {
      const date = new Date("2026-09-15T00:00:00.000Z");
      const time = new Date("1970-01-01T09:00:00.000Z");
      const instant = formatPickupInstant(date, time);
      // 09:00 en reloj de pared argentino es 12:00:00.000Z en UTC
      expect(instant).toBe("2026-09-15T12:00:00.000Z");
    });
  });

  describe("aggregateCarrierStops (AC2)", () => {
    it("un envío en 'assigned' genera 2 paradas (pickup y delivery)", () => {
      const s = createMockShipment({ id: "ship-assigned", status: ShipmentStatus.ASSIGNED });
      const stops = aggregateCarrierStops([s]);

      expect(stops).toHaveLength(2);
      expect(stops[0]).toMatchObject({
        shipmentId: "ship-assigned",
        type: "pickup",
        lat: s.pickupLat,
        lng: s.pickupLng,
        address: "Av. Colón 123",
      });
      expect(stops[1]).toMatchObject({
        shipmentId: "ship-assigned",
        type: "delivery",
        lat: s.deliveryLat,
        lng: s.deliveryLng,
        address: "San Martín 456",
      });
    });

    it("un envío en 'in_transit' genera solo 1 parada (delivery)", () => {
      const s = createMockShipment({ id: "ship-transit", status: ShipmentStatus.IN_TRANSIT });
      const stops = aggregateCarrierStops([s]);

      expect(stops).toHaveLength(1);
      expect(stops[0]).toMatchObject({
        shipmentId: "ship-transit",
        type: "delivery",
        lat: s.deliveryLat,
        lng: s.deliveryLng,
        address: "San Martín 456",
      });
    });

    it("un envío en 'assigned_unfunded' NO aporta paradas", () => {
      const s = createMockShipment({ id: "ship-unfunded", status: ShipmentStatus.ASSIGNED_UNFUNDED });
      const stops = aggregateCarrierStops([s]);
      expect(stops).toHaveLength(0);
    });

    it("un envío en 'delivered' o 'completed' NO aporta paradas", () => {
      const s1 = createMockShipment({ id: "ship-deliv", status: ShipmentStatus.DELIVERED });
      const s2 = createMockShipment({ id: "ship-compl", status: ShipmentStatus.COMPLETED });
      const stops = aggregateCarrierStops([s1, s2]);
      expect(stops).toHaveLength(0);
    });

    it("maneja una combinación de múltiples envíos correctamente", () => {
      const s1 = createMockShipment({ id: "s1", status: ShipmentStatus.ASSIGNED });
      const s2 = createMockShipment({ id: "s2", status: ShipmentStatus.IN_TRANSIT });
      const s3 = createMockShipment({ id: "s3", status: ShipmentStatus.ASSIGNED_UNFUNDED });
      const s4 = createMockShipment({ id: "s4", status: ShipmentStatus.DELIVERED });

      const stops = aggregateCarrierStops([s1, s2, s3, s4]);
      // s1 aporta 2, s2 aporta 1, s3 aporta 0, s4 aporta 0 => total 3
      expect(stops).toHaveLength(3);
      expect(stops.map((s) => `${s.shipmentId}:${s.type}`)).toEqual([
        "s1:pickup",
        "s1:delivery",
        "s2:delivery",
      ]);
    });
  });

  describe("buildEmptyRoute (AC4)", () => {
    it("devuelve una ruta vacía con status optimizado y 0 km/min", () => {
      const empty = buildEmptyRoute();
      expect(empty).toEqual({
        stops: [],
        totalDistanceKm: 0,
        totalDurationMinutes: 0,
        optimized: true,
        disclaimer: "Ruta sin paradas asignadas.",
      });
    });
  });

  describe("buildDegradedRoute (AC6)", () => {
    it("ordena retiros antes que entregas, y dentro de cada grupo por ventana horaria", () => {
      const stops = [
        {
          shipmentId: "deliv-tarde",
          type: "delivery" as const,
          lat: -31.4,
          lng: -64.1,
          timeWindowStart: "2026-09-15T18:00:00.000Z",
        },
        {
          shipmentId: "pickup-tarde",
          type: "pickup" as const,
          lat: -31.42,
          lng: -64.12,
          timeWindowStart: "2026-09-15T11:00:00.000Z",
        },
        {
          shipmentId: "pickup-temprano",
          type: "pickup" as const,
          lat: -31.41,
          lng: -64.11,
          timeWindowStart: "2026-09-15T09:00:00.000Z",
        },
        {
          shipmentId: "deliv-temprano",
          type: "delivery" as const,
          lat: -31.43,
          lng: -64.13,
          timeWindowStart: "2026-09-15T14:00:00.000Z",
        },
      ];

      const degraded = buildDegradedRoute(stops);

      expect(degraded.optimized).toBe(false);
      expect(degraded.disclaimer).toContain("Ruta ordenada por defecto");
      expect(degraded.stops).toHaveLength(4);

      // Verificamos numeración 1..N
      expect(degraded.stops.map((s) => s.stopOrder)).toEqual([1, 2, 3, 4]);

      // Verificamos orden: pickups ordenados, luego deliveries ordenados
      expect(degraded.stops.map((s) => s.shipmentId)).toEqual([
        "pickup-temprano",
        "pickup-tarde",
        "deliv-temprano",
        "deliv-tarde",
      ]);
    });
  });

  describe("mapOptimizedRoute", () => {
    it("asigna numeración 1-indexed a las paradas ordenadas por el solver", () => {
      const mockSolverResponse = {
        stops: [
          {
            stopOrder: 0,
            shipmentId: "s1",
            type: "pickup" as const,
            lat: -31.41,
            lng: -64.18,
            estimatedArrivalMinutes: 12.0,
            outsideTimeWindow: false,
          },
          {
            stopOrder: 1,
            shipmentId: "s1",
            type: "delivery" as const,
            lat: -31.45,
            lng: -64.2,
            estimatedArrivalMinutes: 35.5,
            outsideTimeWindow: false,
          },
        ],
        totalDistanceKm: 15.2,
        totalDurationMinutes: 45.0,
        status: "OPTIMAL" as const,
        calculationMethod: "haversine_vrptw_v1",
        disclaimer: "Estimación geométrica",
      };

      const mapped = mapOptimizedRoute(mockSolverResponse as any);
      expect(mapped.optimized).toBe(true);
      expect(mapped.stops[0]!.stopOrder).toBe(1);
      expect(mapped.stops[1]!.stopOrder).toBe(2);
      expect(mapped.totalDistanceKm).toBe(15.2);
      expect(mapped.totalDurationMinutes).toBe(45.0);
    });
  });
});
