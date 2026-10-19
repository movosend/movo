import { describe, expect, it } from "vitest";
import {
  pickReusableTrip,
  ReusableTripCandidate,
  TRIP_PICKUP_WINDOW_LEAD_HOURS,
  tripDepartureFitsPickupWindow,
} from "../src/domain/trip-compatibility";

const HOUR = 60 * 60 * 1000;
// Ventana de retiro 09:00-12:00 ART (UTC-3) del 2030-01-01.
const windowStart = new Date("2030-01-01T12:00:00.000Z");
const windowEnd = new Date("2030-01-01T15:00:00.000Z");
const at = (ms: number) => new Date(windowStart.getTime() + ms);

describe("tripDepartureFitsPickupWindow (MOVO-314)", () => {
  it("acepta una salida dentro de la ventana y en sus dos bordes", () => {
    expect(tripDepartureFitsPickupWindow(at(HOUR), windowStart, windowEnd)).toBe(true);
    expect(tripDepartureFitsPickupWindow(windowStart, windowStart, windowEnd)).toBe(true);
    expect(tripDepartureFitsPickupWindow(windowEnd, windowStart, windowEnd)).toBe(true);
  });

  it("acepta salir hasta LEAD horas antes del inicio, no más", () => {
    expect(tripDepartureFitsPickupWindow(at(-TRIP_PICKUP_WINDOW_LEAD_HOURS * HOUR), windowStart, windowEnd)).toBe(true);
    expect(tripDepartureFitsPickupWindow(at(-TRIP_PICKUP_WINDOW_LEAD_HOURS * HOUR - 1), windowStart, windowEnd)).toBe(false);
  });

  it("rechaza salir después del cierre de la ventana", () => {
    expect(tripDepartureFitsPickupWindow(new Date(windowEnd.getTime() + 1), windowStart, windowEnd)).toBe(false);
  });

  it("rechaza otro día calendario argentino aunque la diferencia sea chica", () => {
    // 02:00 ART del día siguiente vs. ventana 23:00-23:30 ART: 3 h después del cierre y otro día.
    const lateStart = new Date("2030-01-02T02:00:00.000Z");
    const lateEnd = new Date("2030-01-02T02:30:00.000Z");
    expect(tripDepartureFitsPickupWindow(new Date("2030-01-02T03:30:00.000Z"), lateStart, lateEnd)).toBe(false);
  });
});

// Corredor Córdoba norte -> centro.
const trip = (id: string, overrides: Partial<ReusableTripCandidate> = {}): ReusableTripCandidate => ({
  id,
  originLat: -31.35,
  originLng: -64.2,
  destinationLat: -31.42,
  destinationLng: -64.19,
  departureAt: windowStart,
  ...overrides,
});
const shipment = { pickupLat: -31.35, pickupLng: -64.2, deliveryLat: -31.44, deliveryLng: -64.19 };
const window = { start: windowStart, end: windowEnd };

describe("pickReusableTrip (MOVO-314)", () => {
  it("devuelve el viaje cuando retiro y entrega caen dentro del desvío y la salida entra en la ventana", () => {
    expect(pickReusableTrip([trip("a")], shipment, window, 15)?.id).toBe("a");
  });

  it("un viaje que sale 3 h después del inicio entra si la ventana sigue abierta", () => {
    expect(pickReusableTrip([trip("a", { departureAt: at(3 * HOUR) })], shipment, window, 15)?.id).toBe("a");
  });

  it("descarta viajes que salen después del cierre de la ventana", () => {
    expect(pickReusableTrip([trip("a", { departureAt: new Date(windowEnd.getTime() + 1) })], shipment, window, 15)).toBeNull();
  });

  it("descarta viajes con la entrega fuera del desvío", () => {
    const farDelivery = { ...shipment, deliveryLat: -34.6, deliveryLng: -58.38 };
    expect(pickReusableTrip([trip("a")], farDelivery, window, 15)).toBeNull();
  });

  it("entre varios elige el de menor desvío total; a igual desvío, la salida más cercana al inicio", () => {
    const off = trip("off", { originLng: -64.1, destinationLng: -64.09 });
    expect(pickReusableTrip([off, trip("on")], shipment, window, 15)?.id).toBe("on");

    const later = trip("later", { departureAt: at(HOUR) });
    expect(pickReusableTrip([later, trip("same")], shipment, window, 15)?.id).toBe("same");
  });

  it("sin candidatos devuelve null", () => {
    expect(pickReusableTrip([], shipment, window, 15)).toBeNull();
  });
});
