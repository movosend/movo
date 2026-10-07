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

export type OptimizationObjective = "time" | "distance";

/**
 * Matriz ya calculada, en orden canónico `[carrierLocation, pickups..., deliveries...,
 * finalLocation]` (con solo entregas coincide con el orden de `stops`). La pasa el
 * módulo demo de `movo-svc-shipments` (juego del optimizador) para no volver a facturar
 * elementos de Google en cada partida.
 */
export interface PrecomputedMatrix {
  distKm: number[][];
  timeMin: number[][];
}

export interface OptimizeRouteRequest {
  carrierLocation: Coordinates;
  stops: RouteStopInput[];
  departureTime?: string | null;
  finalLocation?: Coordinates | null;
  /** Default `time`. `distance` solo lo pide el juego del optimizador. */
  objective?: OptimizationObjective;
  matrix?: PrecomputedMatrix | null;
}

/** `POST /routes/matrix` de `movo-svc-pricing-logistics` (hasta 25 puntos). */
export interface RouteMatrixRequest {
  points: Coordinates[];
}

export interface RouteMatrixResponse {
  distKm: number[][];
  timeMin: number[][];
  provider: string;
  /** Elementos facturables pedidos a Google (0 con el mock). */
  elementsBilled: number;
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
export type CarrierRouteStop = RouteStopOutput;

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

