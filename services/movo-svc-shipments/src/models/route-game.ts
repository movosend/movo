/** Punto de una partida tal como se guarda y se muestra (`[nombre, barrio, lat, lng]` del pool). */
export interface RouteGamePoint {
  name: string;
  zone: string;
  lat: number;
  lng: number;
}

export interface RouteGamePoints {
  start: RouteGamePoint;
  stops: RouteGamePoint[];
  end: RouteGamePoint;
}

/** `server`: km medidos con la matriz cacheada. `client`: partida offline, números del iPad. */
export type RouteGameComputedBy = "server" | "client";

/** Fila completa de `route_game_sessions`, ya resuelta por el servicio. */
export interface RouteGameSessionRecord {
  id: string;
  eventTag: string;
  deviceId: string | null;
  startedAt: Date;
  endedAt: Date;
  scenarioId: string;
  city: string;
  points: RouteGamePoints;
  stopCount: number;
  userOrder: number[];
  optimalOrder: number[];
  userKm: number;
  optimalKm: number;
  extraKm: number;
  userMin: number;
  optimalMin: number;
  extraMin: number;
  efficiencyPct: number;
  tie: boolean;
  timeUsedSec: number;
  timeLimitSec: number | null;
  timedOut: boolean;
  distanceMethod: string | null;
  computedBy: RouteGameComputedBy;
  name: string | null;
  inRanking: boolean;
  email: string | null;
  userAgent: string | null;
}

/** Resultado de una partida tal como quedó guardado (lo que devuelve el `PUT`). */
export type RouteGameScore = Pick<
  RouteGameSessionRecord,
  | "computedBy"
  | "userKm"
  | "optimalKm"
  | "userMin"
  | "optimalMin"
  | "extraKm"
  | "extraMin"
  | "efficiencyPct"
  | "tie"
  | "optimalOrder"
  | "distanceMethod"
>;
