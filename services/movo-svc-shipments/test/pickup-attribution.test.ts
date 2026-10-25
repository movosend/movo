import { describe, it, expect } from "vitest";
import { ShipmentStatus, TripStatus } from "@movo/shared";
import {
  attributePickupMiss,
  classifyPickupPosition,
  PickupEvidenceSummary,
  pickupEvidenceWindow,
} from "../src/domain/pickup-attribution";

// Retiro el 15/10 de 14:00 a 18:00 en Argentina (17:00 a 21:00 UTC).
const shipment = {
  pickupLat: -31.4201,
  pickupLng: -64.1888,
  pickupDate: new Date("2026-10-15T00:00:00.000Z"),
  pickupTimeWindowStart: new Date("1970-01-01T14:00:00.000Z"),
  pickupTimeWindowEnd: new Date("1970-01-01T18:00:00.000Z"),
};
const IN_WINDOW = new Date("2026-10-15T18:00:00.000Z");
// ~0,009° de latitud ≈ 1 km.
const METERS_PER_DEG_LAT = 111_195;
const north = (meters: number) => ({ lat: shipment.pickupLat + meters / METERS_PER_DEG_LAT, lng: shipment.pickupLng });
const at = (meters: number, extra: Partial<{ accuracyM: number; capturedAt: Date; mocked: boolean }> = {}) => ({
  ...north(meters),
  accuracyM: 10,
  capturedAt: IN_WINDOW,
  ...extra,
});

describe("classifyPickupPosition (MOVO-270, DD-052)", () => {
  it("la ventana de evidencia empieza 30 min antes de la franja y termina con ella", () => {
    expect(pickupEvidenceWindow(shipment)).toEqual({
      from: new Date("2026-10-15T16:30:00.000Z"),
      to: new Date("2026-10-15T21:00:00.000Z"),
    });
  });

  it("dentro de 250 m es llegada", () => {
    expect(classifyPickupPosition(shipment, at(200))).toBe("arrival");
  });

  it("la precisión informada juega a favor: 330 m con ±90 m es llegada", () => {
    expect(classifyPickupPosition(shipment, at(330, { accuracyM: 90 }))).toBe("arrival");
    expect(classifyPickupPosition(shipment, at(330, { accuracyM: 10 }))).toBe("gray");
  });

  it("más de 2 km (restando la precisión) es lejos; en el medio, zona gris", () => {
    expect(classifyPickupPosition(shipment, at(3000))).toBe("far");
    expect(classifyPickupPosition(shipment, at(2050, { accuracyM: 80 }))).toBe("gray");
    expect(classifyPickupPosition(shipment, at(1000))).toBe("gray");
  });

  it("no cuenta nada una posición simulada, poco precisa o fuera de la ventana", () => {
    expect(classifyPickupPosition(shipment, at(10, { mocked: true }))).toBeNull();
    expect(classifyPickupPosition(shipment, at(10, { accuracyM: 101 }))).toBeNull();
    expect(classifyPickupPosition(shipment, at(10, { capturedAt: new Date("2026-10-15T16:29:00.000Z") }))).toBeNull();
    expect(classifyPickupPosition(shipment, at(10, { capturedAt: new Date("2026-10-15T21:00:01.000Z") }))).toBeNull();
    expect(classifyPickupPosition(shipment, at(10, { capturedAt: new Date("2026-10-15T16:30:00.000Z") }))).toBe("arrival");
  });

  it("mocked: false (Android con GPS real) cuenta normal", () => {
    expect(classifyPickupPosition(shipment, at(10, { mocked: false }))).toBe("arrival");
  });
});

describe("attributePickupMiss (MOVO-270, AC8-AC10)", () => {
  const windowEnd = new Date("2026-10-15T21:00:00.000Z");
  const noEvidence: PickupEvidenceSummary = { arrivedAt: null, farPositionsInWindow: 0, grayPositionsInWindow: 0 };
  const activeOnTime = { status: TripStatus.ACTIVE, startedAt: new Date("2026-10-15T15:00:00.000Z") };
  const base = { shipmentStatus: ShipmentStatus.ASSIGNED, trip: activeOnTime, evidence: noEvidence, pickupWindowEnd: windowEnd };

  it("con llegada registrada: llegó", () => {
    expect(attributePickupMiss({ ...base, evidence: { ...noEvidence, arrivedAt: IN_WINDOW } })).toBe("carrier_arrived");
  });

  it.each([TripStatus.DECLARED, TripStatus.CANCELLED, TripStatus.EXPIRED])("viaje %s: no llegó", (status) => {
    expect(attributePickupMiss({ ...base, trip: { status, startedAt: null } })).toBe("carrier_no_show");
  });

  it("viaje iniciado después del cierre de la ventana: no llegó", () => {
    expect(
      attributePickupMiss({ ...base, trip: { status: TripStatus.ACTIVE, startedAt: new Date(windowEnd.getTime() + 1) } })
    ).toBe("carrier_no_show");
  });

  it("oferta sin viaje asociado: no llegó (no pudo iniciar ningún viaje con el paquete)", () => {
    expect(attributePickupMiss({ ...base, trip: null })).toBe("carrier_no_show");
  });

  it("2 posiciones lejanas no alcanzan; 3 sí", () => {
    expect(attributePickupMiss({ ...base, evidence: { ...noEvidence, farPositionsInWindow: 2 } })).toBe("no_evidence");
    expect(attributePickupMiss({ ...base, evidence: { ...noEvidence, farPositionsInWindow: 3 } })).toBe("carrier_no_show");
  });

  it("una sola posición en zona gris deja el caso sin evidencia", () => {
    expect(
      attributePickupMiss({ ...base, evidence: { ...noEvidence, farPositionsInWindow: 10, grayPositionsInWindow: 1 } })
    ).toBe("no_evidence");
  });

  it("viaje activo sin posiciones, o iniciado antes de MOVO-270 (startedAt null): sin evidencia", () => {
    expect(attributePickupMiss({ ...base, evidence: null })).toBe("no_evidence");
    expect(attributePickupMiss({ ...base, trip: { status: TripStatus.ACTIVE, startedAt: null } })).toBe("no_evidence");
    expect(attributePickupMiss({ ...base, trip: { status: TripStatus.COMPLETED, startedAt: null } })).toBe("no_evidence");
  });

  it.each([ShipmentStatus.ASSIGNMENT_PENDING, ShipmentStatus.ASSIGNED_UNFUNDED])(
    "%s nunca se atribuye (sin hold el retiro era imposible)",
    (shipmentStatus) => {
      expect(attributePickupMiss({ ...base, shipmentStatus, trip: { status: TripStatus.DECLARED, startedAt: null } })).toBe(
        "no_evidence"
      );
    }
  );
});
