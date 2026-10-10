import { CarrierMpAccountStatusResponse } from "@movo/shared";
import { vi } from "vitest";
import { PaymentsClient } from "../src/adapters/payments-client";

/**
 * Fake de `PaymentsClient` (MOVO-116) para tests -- evita depender de un
 * `movo-svc-payments` real levantado, mismo criterio que `fake-users-client.ts`. Por
 * default todo transportista tiene la cuenta de MP vinculada (así los fixtures
 * existentes siguen pasando el bloqueo de ADR-036); `unlinkedUserIds` marca los que no.
 */
export function createFakePaymentsClient(
  unlinkedUserIds: string[] = [],
  overrides: Partial<PaymentsClient> = {}
): PaymentsClient {
  const unlinked = new Set(unlinkedUserIds);
  return {
    getCarrierMpAccountStatus: vi.fn(
      async (userId: string): Promise<CarrierMpAccountStatusResponse> => ({ linked: !unlinked.has(userId) })
    ),
    ...overrides,
  };
}
