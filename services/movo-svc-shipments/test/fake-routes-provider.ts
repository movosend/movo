import { RouteResult, RoutesProvider } from "../src/adapters/routes-provider";

/** Fake de `RoutesProvider` para tests — evita depender de credenciales reales de
 * Google (mismo criterio que `createFakeUsersClient`). */
export function createFakeRoutesProvider(result: RouteResult): RoutesProvider {
  return {
    async getRoute() {
      return result;
    },
  };
}
