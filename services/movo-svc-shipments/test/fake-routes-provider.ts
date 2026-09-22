import { RouteResult, RoutesProvider } from "../src/adapters/routes-provider";

/** Fake de `RoutesProvider` para tests — evita depender de credenciales reales de
 * Google (mismo criterio que `createFakeUsersClient`). Por default, `getRouteDurations`
 * deriva la duración de cada destino del mismo `result.durationSeconds` fijo -- los
 * tests que necesitan un valor por destino pasan su propio `getRouteDurations`. */
export function createFakeRoutesProvider(
  result: RouteResult,
  overrides?: Partial<RoutesProvider>,
): RoutesProvider {
  return {
    async getRoute() {
      return result;
    },
    async getRouteDurations(input) {
      return input.destinations.map((_, destinationIndex) => ({
        destinationIndex,
        durationSeconds: result.durationSeconds,
      }));
    },
    ...overrides,
  };
}
