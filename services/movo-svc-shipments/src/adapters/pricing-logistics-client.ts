import {
  ApiError,
  OptimizeRouteRequest,
  OptimizeRouteResponse,
  RouteMatrixRequest,
  RouteMatrixResponse,
  RouteStopInput,
  RouteStopOutput,
} from "@movo/shared";

export type {
  OptimizeRouteRequest,
  OptimizeRouteResponse,
  RouteMatrixRequest,
  RouteMatrixResponse,
  RouteStopInput,
  RouteStopOutput,
};

export interface EvaluateCandidatesTripInput {
  id: string;
  originLat: number;
  originLng: number;
  destinationLat: number;
  destinationLng: number;
  departureAt: string; // ISO 8601 string
}

export interface EvaluateCandidatePackageInput {
  id: string;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  pickupWindowStart?: string;
  pickupWindowEnd?: string;
  dropoffWindowStart?: string;
  dropoffWindowEnd?: string;
  serviceTimeMinutes?: number;
}

export interface EvaluateCandidatesInput {
  trip: EvaluateCandidatesTripInput;
  candidates: EvaluateCandidatePackageInput[];
}

export interface CandidateEvaluationResult {
  candidateId: string;
  feasible: boolean;
  detourDistanceKm: number | null;
  detourDurationMinutes: number | null;
  totalDistanceKm?: number | null;
  totalDurationMinutes?: number | null;
}

export interface EvaluateCandidatesResult {
  directDistanceKm: number;
  directDurationMinutes: number;
  evaluations: CandidateEvaluationResult[];
  calculationMethod: string;
}

export interface PricingLogisticsClient {
  evaluateCandidates(input: EvaluateCandidatesInput): Promise<EvaluateCandidatesResult>;
  optimizeRoute(input: OptimizeRouteRequest): Promise<OptimizeRouteResponse>;
  /** Matriz NxN sin optimizar (juego del optimizador: se cachea por ciudad). */
  routeMatrix(input: RouteMatrixRequest): Promise<RouteMatrixResponse>;
}

export interface PricingLogisticsClientConfig {
  PRICING_SERVICE_URL: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 1000;

export function createPricingLogisticsClient(
  config: PricingLogisticsClientConfig
): PricingLogisticsClient {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function post<T>(path: string, input: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${config.PRICING_SERVICE_URL}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err: unknown) {
      if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
        throw new ApiError(
          503,
          "ROUTING_SERVICE_UNAVAILABLE",
          "El servicio de ruteo superó el tiempo límite de espera."
        );
      }
      throw new ApiError(
        503,
        "ROUTING_SERVICE_UNAVAILABLE",
        "No se pudo conectar con el servicio de ruteo."
      );
    }

    if (!response.ok) {
      if (response.status === 503) {
        throw new ApiError(
          503,
          "ROUTING_SERVICE_UNAVAILABLE",
          "El servicio de ruteo no está disponible."
        );
      }
      throw new ApiError(
        502,
        "ROUTING_SERVICE_ERROR",
        `El servicio de ruteo respondió con error HTTP ${response.status}.`
      );
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new ApiError(
        502,
        "ROUTING_SERVICE_ERROR",
        "Respuesta inválida o malformada del servicio de ruteo."
      );
    }
  }

  return {
    evaluateCandidates: (input) =>
      post<EvaluateCandidatesResult>("/routes/evaluate-candidates", input),
    optimizeRoute: (input) => post<OptimizeRouteResponse>("/optimize/route", input),
    routeMatrix: (input) => post<RouteMatrixResponse>("/routes/matrix", input),
  };
}
