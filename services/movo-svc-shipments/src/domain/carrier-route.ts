import { CarrierRoute, CarrierRouteStop, OptimizeRouteResponse, RouteStopInput, ShipmentStatus } from "@movo/shared";
import { Shipment } from "../models/shipment";

const ARGENTINA_UTC_OFFSET_HOURS = 3;

import { formatPickupInstant } from "./pickup-window";
export { formatPickupInstant };

/**
 * Combina la fecha estimada de entrega y la franja horaria string (ej: "14:00")
 * en un instante UTC en formato ISO 8601 si ambos existen, o devuelve la franja.
 */
export function formatDeliveryInstant(deliveryDate: Date | null, timeStr: string | null): string | null {
  if (!timeStr) return null;
  if (!deliveryDate) return timeStr;

  const parts = timeStr.split(":").map((p) => parseInt(p, 10));
  if (parts.length >= 2 && !isNaN(parts[0]!) && !isNaN(parts[1]!)) {
    const anchored = Date.UTC(
      deliveryDate.getUTCFullYear(),
      deliveryDate.getUTCMonth(),
      deliveryDate.getUTCDate(),
      parts[0]!,
      parts[1]!,
      parts[2] ?? 0
    );
    const realUtc = new Date(anchored + ARGENTINA_UTC_OFFSET_HOURS * 60 * 60 * 1000);
    return realUtc.toISOString();
  }
  return timeStr;
}

/**
 * MOVO-206 AC2: Composición de paradas del transportista.
 * - Para cada envío en `assigned`: incluye parada de retiro y parada de entrega.
 * - Para cada envío en `in_transit`: incluye solo parada de entrega (ya fue retirado).
 * - Envíos en `assigned_unfunded`: se ignoran (retiro a más de N días, no ejecutable hoy).
 * - Envíos en `delivered`, `completed` u otros: se ignoran.
 */
export function aggregateCarrierStops(shipments: Shipment[]): RouteStopInput[] {
  const stops: RouteStopInput[] = [];

  for (const s of shipments) {
    if (s.status === ShipmentStatus.ASSIGNED) {
      // Parada de retiro
      const pickupStart = s.pickupDate && s.pickupTimeWindowStart
        ? formatPickupInstant(s.pickupDate, s.pickupTimeWindowStart)
        : null;
      const pickupEnd = s.pickupDate && s.pickupTimeWindowEnd
        ? formatPickupInstant(s.pickupDate, s.pickupTimeWindowEnd)
        : null;

      stops.push({
        shipmentId: s.id,
        type: "pickup",
        lat: s.pickupLat,
        lng: s.pickupLng,
        address: s.pickupAddress ?? null,
        timeWindowStart: pickupStart,
        timeWindowEnd: pickupEnd,
      });

      // Parada de entrega
      const deliveryStart = formatDeliveryInstant(
        s.estimatedDeliveryDate,
        s.estimatedDeliveryTimeWindowStart
      );
      const deliveryEnd = formatDeliveryInstant(
        s.estimatedDeliveryDate,
        s.estimatedDeliveryTimeWindowEnd
      );

      stops.push({
        shipmentId: s.id,
        type: "delivery",
        lat: s.deliveryLat,
        lng: s.deliveryLng,
        address: s.deliveryAddress ?? null,
        timeWindowStart: deliveryStart,
        timeWindowEnd: deliveryEnd,
      });
    } else if (s.status === ShipmentStatus.IN_TRANSIT) {
      // Solo entrega: el paquete ya está en el vehículo
      const deliveryStart = formatDeliveryInstant(
        s.estimatedDeliveryDate,
        s.estimatedDeliveryTimeWindowStart
      );
      const deliveryEnd = formatDeliveryInstant(
        s.estimatedDeliveryDate,
        s.estimatedDeliveryTimeWindowEnd
      );

      stops.push({
        shipmentId: s.id,
        type: "delivery",
        lat: s.deliveryLat,
        lng: s.deliveryLng,
        address: s.deliveryAddress ?? null,
        timeWindowStart: deliveryStart,
        timeWindowEnd: deliveryEnd,
      });
    }
  }

  return stops;
}

/**
 * MOVO-206 AC4: Ruta vacía cuando el transportista no tiene paradas activas.
 */
export function buildEmptyRoute(): CarrierRoute {
  return {
    stops: [],
    totalDistanceKm: 0,
    totalDurationMinutes: 0,
    optimized: true,
    disclaimer: "Ruta sin paradas asignadas.",
  };
}

/**
 * MOVO-206 AC6: Fallback heurístico de degradación cuando pricing-logistics no responde.
 * - Todos los retiros antes que las entregas.
 * - Dentro de cada grupo, ordenados por ventana horaria de inicio ascendente.
 * - Marca `optimized: false`.
 */
export function buildDegradedRoute(stops: RouteStopInput[]): CarrierRoute {
  const compareByWindowStart = (a: RouteStopInput, b: RouteStopInput): number => {
    if (a.timeWindowStart && b.timeWindowStart) {
      return a.timeWindowStart.localeCompare(b.timeWindowStart);
    }
    if (a.timeWindowStart && !b.timeWindowStart) return -1;
    if (!a.timeWindowStart && b.timeWindowStart) return 1;
    return a.shipmentId.localeCompare(b.shipmentId);
  };

  const pickups = stops.filter((s) => s.type === "pickup").sort(compareByWindowStart);
  const deliveries = stops.filter((s) => s.type === "delivery").sort(compareByWindowStart);
  const orderedStops = [...pickups, ...deliveries];

  const carrierStops: CarrierRouteStop[] = orderedStops.map((stop, idx) => ({
    stopOrder: idx + 1,
    shipmentId: stop.shipmentId,
    type: stop.type,
    address: stop.address ?? null,
    lat: stop.lat,
    lng: stop.lng,
    timeWindowStart: stop.timeWindowStart ?? null,
    timeWindowEnd: stop.timeWindowEnd ?? null,
    estimatedArrivalMinutes: 0,
    estimatedArrivalAt: null,
    estimatedDepartureAt: null,
    outsideTimeWindow: false,
  }));

  return {
    stops: carrierStops,
    totalDistanceKm: 0,
    totalDurationMinutes: 0,
    optimized: false,
    disclaimer:
      "Ruta ordenada por defecto (servicio de ruteo no disponible). Se priorizan retiros antes que entregas.",
  };
}

/**
 * Mapea la respuesta optimizada de OR-Tools a la estructura CarrierRoute,
 * normalizando `stopOrder` a 1-indexed.
 */
export function mapOptimizedRoute(response: OptimizeRouteResponse): CarrierRoute {
  return {
    stops: response.stops.map((stop, idx) => ({
      ...stop,
      stopOrder: idx + 1,
    })),
    totalDistanceKm: response.totalDistanceKm,
    totalDurationMinutes: response.totalDurationMinutes,
    optimized: true,
    disclaimer: response.disclaimer,
  };
}
