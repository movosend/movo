/**
 * Wire contract de `POST /optimize/route` en `movo-svc-pricing-logistics` (MOVO-205).
 * Consumido por `movo-svc-shipments` (MOVO-206: `GET /shipments/my-route`) y por la
 * app mobile (MOVO-10/MOVO-207: mapa de ruta multi-parada).
 */

export type RouteStopType = "pickup" | "delivery";

export enum OptimizationStatus {
  OPTIMAL = "OPTIMAL",
  FEASIBLE = "FEASIBLE",
  EMPTY = "EMPTY",
}

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface RouteStopInput {
  shipmentId: string;
  type: RouteStopType;
  lat: number;
  lng: number;
  address?: string | null;
  timeWindowStart?: string | null;
  timeWindowEnd?: string | null;
  serviceTimeMinutes?: number | null;
}

export interface OptimizeRouteRequest {
  carrierLocation: Coordinates;
  stops: RouteStopInput[];
  departureTime?: string | null;
  finalLocation?: Coordinates | null;
}

export interface RouteStopOutput {
  stopOrder: number;
  shipmentId: string;
  type: RouteStopType;
  lat: number;
  lng: number;
  address?: string | null;
  estimatedArrivalMinutes: number;
  estimatedArrivalAt?: string | null;
  estimatedDepartureAt?: string | null;
  timeWindowStart?: string | null;
  timeWindowEnd?: string | null;
  outsideTimeWindow: boolean;
}

export interface OptimizeRouteResponse {
  stops: RouteStopOutput[];
  totalDistanceKm: number;
  totalDurationMinutes: number;
  status: OptimizationStatus;
  calculationMethod: string;
  disclaimer: string;
}

/**
 * Parada secuenciada en la ruta del transportista para `GET /shipments/my-route` (MOVO-206).
 */
export interface CarrierRouteStop extends RouteStopOutput {}

/**
 * Hoja de ruta diaria optimizada del transportista (MOVO-206).
 */
export interface CarrierRoute {
  stops: CarrierRouteStop[];
  totalDistanceKm: number;
  totalDurationMinutes: number;
  optimized: boolean;
  disclaimer: string | null;
}

