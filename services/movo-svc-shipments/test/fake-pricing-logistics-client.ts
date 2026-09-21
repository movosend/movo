import { vi } from "vitest";
import {
  EvaluateCandidatesInput,
  EvaluateCandidatesResult,
  OptimizeRouteRequest,
  OptimizeRouteResponse,
  PricingLogisticsClient,
} from "../src/adapters/pricing-logistics-client";

/**
 * Fake de `PricingLogisticsClient` para tests — evita depender de un
 * `movo-svc-pricing-logistics` real levantado (mismo criterio que
 * `fake-pricing-client.ts`). Por default `evaluateCandidates` resuelve `feasible: true`
 * para cada candidato recibido — pasar `evaluateCandidates` en `overrides` para simular
 * un candidato inviable o un fallo del servicio (MOVO-179,
 * `evaluateTripMatchFeasibility` trata cualquier rechazo como "no viable, no notifica").
 */
export function createFakePricingLogisticsClient(
  overrides: Partial<PricingLogisticsClient> = {}
): PricingLogisticsClient {
  return {
    evaluateCandidates: vi.fn(
      async (input: EvaluateCandidatesInput): Promise<EvaluateCandidatesResult> => ({
        directDistanceKm: 10,
        directDurationMinutes: 15,
        calculationMethod: "or_tools_v1",
        evaluations: input.candidates.map((candidate) => ({
          candidateId: candidate.id,
          feasible: true,
          detourDistanceKm: 1,
          detourDurationMinutes: 2,
        })),
      })
    ),
    optimizeRoute: vi.fn(async (_input: OptimizeRouteRequest): Promise<OptimizeRouteResponse> => {
      throw new Error("createFakePricingLogisticsClient: optimizeRoute no está mockeado en este fake");
    }),
    ...overrides,
  };
}
