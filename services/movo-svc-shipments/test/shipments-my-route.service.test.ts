import { describe, it, expect, vi, beforeEach } from "vitest";
import { ShipmentStatus, TripStatus } from "@movo/shared";
import { createShipmentsService } from "../src/modules/shipments/shipments.service";
import { ShipmentRepository } from "../src/repositories/shipment-repository";
import { TripRepository } from "../src/repositories/trip-repository";
import { PricingLogisticsClient } from "../src/adapters/pricing-logistics-client";
import { Shipment } from "../src/models/shipment";
import { Trip } from "../src/models/trip";

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

describe("ShipmentsService.getMyRoute (MOVO-206)", () => {
  let mockRepository: Partial<ShipmentRepository>;
  let mockPricingLogisticsClient: PricingLogisticsClient;
  const CARRIER_ID = "carrier-123";
  const CARRIER_LOCATION = { lat: -31.4167, lng: -64.1833 };

  beforeEach(() => {
    mockRepository = {
      listActiveShipments: vi.fn().mockResolvedValue([]),
    };

    mockPricingLogisticsClient = {
      evaluateCandidates: vi.fn(),
      optimizeRoute: vi.fn().mockResolvedValue({
        stops: [
          {
            stopOrder: 0,
            shipmentId: "shipment-1",
            type: "pickup",
            lat: -31.4167,
            lng: -64.1833,
            estimatedArrivalMinutes: 5.0,
            outsideTimeWindow: false,
          },
          {
            stopOrder: 1,
            shipmentId: "shipment-1",
            type: "delivery",
            lat: -31.425,
            lng: -64.19,
            estimatedArrivalMinutes: 20.0,
            outsideTimeWindow: false,
          },
        ],
        totalDistanceKm: 12.5,
        totalDurationMinutes: 30.0,
        status: "OPTIMAL",
        calculationMethod: "haversine_vrptw_v1",
        disclaimer: "Estimación geométrica",
      }),
    };
  });

  it("AC4: Si el transportista no tiene envíos activos, devuelve ruta vacía (200) sin llamar a OR-Tools", async () => {
    mockRepository.listActiveShipments = vi.fn().mockResolvedValue([]);

    const service = createShipmentsService(
      mockRepository as ShipmentRepository,
      {} as any,
      undefined,
      undefined,
      { pricingLogisticsClient: mockPricingLogisticsClient }
    );

    const route = await service.getMyRoute(CARRIER_ID, CARRIER_LOCATION);

    expect(mockRepository.listActiveShipments).toHaveBeenCalledWith("carrierId", CARRIER_ID, undefined);
    expect(mockPricingLogisticsClient.optimizeRoute).not.toHaveBeenCalled();
    expect(route).toEqual({
      stops: [],
      totalDistanceKm: 0,
      totalDurationMinutes: 0,
      optimized: true,
      disclaimer: "Ruta sin paradas asignadas.",
    });
  });

  it("AC2/AC5: Con 1 envío en assigned, llama al solver con 2 paradas y retorna ruta optimizada", async () => {
    const shipment = createMockShipment({ id: "s1", status: ShipmentStatus.ASSIGNED });
    mockRepository.listActiveShipments = vi.fn().mockResolvedValue([shipment]);

    const service = createShipmentsService(
      mockRepository as ShipmentRepository,
      {} as any,
      undefined,
      undefined,
      { pricingLogisticsClient: mockPricingLogisticsClient }
    );

    const route = await service.getMyRoute(CARRIER_ID, CARRIER_LOCATION);

    expect(mockPricingLogisticsClient.optimizeRoute).toHaveBeenCalledWith({
      carrierLocation: CARRIER_LOCATION,
      stops: [
        expect.objectContaining({ shipmentId: "s1", type: "pickup" }),
        expect.objectContaining({ shipmentId: "s1", type: "delivery" }),
      ],
    });
    expect(route.optimized).toBe(true);
    expect(route.stops).toHaveLength(2);
    expect(route.stops[0]!.stopOrder).toBe(1);
    expect(route.stops[1]!.stopOrder).toBe(2);
    expect(route.totalDistanceKm).toBe(12.5);
  });

  it("AC6: Degradación si pricing-logistics falla, retorna ruta ordenada heurísticamente con optimized: false", async () => {
    const s1 = createMockShipment({ id: "s1", status: ShipmentStatus.ASSIGNED });
    mockRepository.listActiveShipments = vi.fn().mockResolvedValue([s1]);

    mockPricingLogisticsClient.optimizeRoute = vi.fn().mockRejectedValue(new Error("Network timeout"));

    const service = createShipmentsService(
      mockRepository as ShipmentRepository,
      {} as any,
      undefined,
      undefined,
      { pricingLogisticsClient: mockPricingLogisticsClient }
    );

    const route = await service.getMyRoute(CARRIER_ID, CARRIER_LOCATION);

    expect(route.optimized).toBe(false);
    expect(route.disclaimer).toContain("Ruta ordenada por defecto");
    expect(route.stops).toHaveLength(2);
    expect(route.stops[0]!.type).toBe("pickup");
    expect(route.stops[1]!.type).toBe("delivery");
  });

  it("AC6: Si pricingLogisticsClient no fue inyectado, degrada limpiamente sin lanzar excepción", async () => {
    const s1 = createMockShipment({ id: "s1", status: ShipmentStatus.ASSIGNED });
    mockRepository.listActiveShipments = vi.fn().mockResolvedValue([s1]);

    const service = createShipmentsService(
      mockRepository as ShipmentRepository,
      {} as any,
      undefined,
      undefined,
      {}
    );

    const route = await service.getMyRoute(CARRIER_ID, CARRIER_LOCATION);

    expect(route.optimized).toBe(false);
    expect(route.stops).toHaveLength(2);
  });
});

function createMockTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "trip-1",
    carrierId: "carrier-123",
    originAddress: "Córdoba",
    originLat: -31.4167,
    originLng: -64.1833,
    destinationAddress: "Villa María",
    destinationLat: -32.4079,
    destinationLng: -63.2402,
    departureAt: new Date("2026-09-21T14:00:00.000Z"),
    vehicleType: "car",
    status: TripStatus.ACTIVE,
    createdAt: new Date("2026-09-20T10:00:00.000Z"),
    updatedAt: new Date("2026-09-20T10:00:00.000Z"),
    ...overrides,
  };
}

describe("ShipmentsService.getMyRoute con tripId (MOVO-235)", () => {
  let mockRepository: Partial<ShipmentRepository>;
  let mockTripRepository: Partial<TripRepository>;
  let mockPricingLogisticsClient: PricingLogisticsClient;
  const CARRIER_ID = "carrier-123";
  const CARRIER_LOCATION = { lat: -31.4167, lng: -64.1833 };
  const TRIP_ID = "trip-1";

  beforeEach(() => {
    mockRepository = { listActiveShipments: vi.fn().mockResolvedValue([]) };
    mockTripRepository = { findById: vi.fn().mockResolvedValue(createMockTrip()) };
    mockPricingLogisticsClient = {
      evaluateCandidates: vi.fn(),
      optimizeRoute: vi.fn().mockResolvedValue({
        stops: [],
        totalDistanceKm: 0,
        totalDurationMinutes: 0,
        status: "OPTIMAL",
        calculationMethod: "haversine_vrptw_v1",
        disclaimer: null,
      }),
    };
  });

  function buildService() {
    return createShipmentsService(mockRepository as ShipmentRepository, {} as any, undefined, undefined, {
      pricingLogisticsClient: mockPricingLogisticsClient,
      tripRepository: mockTripRepository as TripRepository,
    });
  }

  it("AC1: con tripId, propaga el filtro al repositorio", async () => {
    const service = buildService();

    await service.getMyRoute(CARRIER_ID, CARRIER_LOCATION, TRIP_ID);

    expect(mockTripRepository.findById).toHaveBeenCalledWith(TRIP_ID);
    expect(mockRepository.listActiveShipments).toHaveBeenCalledWith("carrierId", CARRIER_ID, TRIP_ID);
  });

  it("AC2: sin tripId, no consulta tripRepository y llama al repositorio sin acotar", async () => {
    const service = buildService();

    await service.getMyRoute(CARRIER_ID, CARRIER_LOCATION);

    expect(mockTripRepository.findById).not.toHaveBeenCalled();
    expect(mockRepository.listActiveShipments).toHaveBeenCalledWith("carrierId", CARRIER_ID, undefined);
  });

  it("AC3: 404 TRIP_NOT_FOUND si el viaje no existe", async () => {
    mockTripRepository.findById = vi.fn().mockResolvedValue(null);
    const service = buildService();

    await expect(service.getMyRoute(CARRIER_ID, CARRIER_LOCATION, TRIP_ID)).rejects.toMatchObject({
      statusCode: 404,
      code: "TRIP_NOT_FOUND",
    });
  });

  it("AC3: 403 AUTH_FORBIDDEN si el viaje es de otro transportista", async () => {
    mockTripRepository.findById = vi.fn().mockResolvedValue(createMockTrip({ carrierId: "otro-carrier" }));
    const service = buildService();

    await expect(service.getMyRoute(CARRIER_ID, CARRIER_LOCATION, TRIP_ID)).rejects.toMatchObject({
      statusCode: 403,
      code: "AUTH_FORBIDDEN",
    });
  });

  it("AC4: 409 TRIP_NOT_ACTIVE si el viaje sigue declared", async () => {
    mockTripRepository.findById = vi.fn().mockResolvedValue(createMockTrip({ status: TripStatus.DECLARED }));
    const service = buildService();

    await expect(service.getMyRoute(CARRIER_ID, CARRIER_LOCATION, TRIP_ID)).rejects.toMatchObject({
      statusCode: 409,
      code: "TRIP_NOT_ACTIVE",
    });
  });

  it("AC4: 409 TRIP_NOT_ACTIVE si el viaje está cancelled/completed", async () => {
    mockTripRepository.findById = vi.fn().mockResolvedValue(createMockTrip({ status: TripStatus.COMPLETED }));
    const service = buildService();

    await expect(service.getMyRoute(CARRIER_ID, CARRIER_LOCATION, TRIP_ID)).rejects.toMatchObject({
      statusCode: 409,
      code: "TRIP_NOT_ACTIVE",
    });
  });

  it("lanza si se pasa tripId sin haber inyectado tripRepository", async () => {
    const service = createShipmentsService(mockRepository as ShipmentRepository, {} as any, undefined, undefined, {
      pricingLogisticsClient: mockPricingLogisticsClient,
    });

    await expect(service.getMyRoute(CARRIER_ID, CARRIER_LOCATION, TRIP_ID)).rejects.toThrow(
      /requiere tripRepository/,
    );
  });
});
