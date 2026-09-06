import { vi } from "vitest";
import { FundsReleaseNotification, FundsReleaseNotifier } from "../src/adapters/funds-release-notifier";

/**
 * Fake de `FundsReleaseNotifier` para tests -- mismo criterio que
 * `fake-notifications-client.ts`. Por default resuelve sin rechazar; pasar `notify`
 * en `overrides` para simular un fallo y verificar que el caller lo trata como
 * best-effort (AC7 de MOVO-158).
 */
export function createFakeFundsReleaseNotifier(overrides: Partial<FundsReleaseNotifier> = {}): FundsReleaseNotifier {
  return {
    notify: vi.fn(async (_input: FundsReleaseNotification) => {}),
    ...overrides,
  };
}
