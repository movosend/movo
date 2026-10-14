import { createConsoleFundsReleaseNotifier } from "./console-funds-release-notifier";
import { createPaymentsFundsReleaseNotifier } from "./payments-funds-release-notifier";
import type { SettlementService } from "../modules/settlements/settlement.service";

export interface FundsReleaseNotification {
  shipmentId: string;
  /** A quién le corresponde cobrar -- el transportista de este envío. */
  carrierId: string;
}

/**
 * AC7 de MOVO-158: la transición a `delivered` dispara esta interfaz, mismo molde que
 * `SmsProvider`/`EmailProvider` (ADR-012/017): implementación no-op/log en dev-test y, desde
 * MOVO-212, la real (`payments-funds-release-notifier.ts`) que captura el hold.
 */
export interface FundsReleaseNotifier {
  notify(input: FundsReleaseNotification): Promise<void>;
}

export interface FundsReleaseNotifierConfig {
  FUNDS_RELEASE_NOTIFIER: "console" | "payments";
}

/**
 * Selecciona la implementación según `FUNDS_RELEASE_NOTIFIER`: "console" (default de
 * dev/test/CI, solo loguea) o "payments" (MOVO-212, captura el hold real y completa el
 * envío). La real necesita el `SettlementService`; pedirla sin él es un error de cableado
 * y falla al arrancar en vez de degradar en silencio a un no-op que dejaría envíos
 * entregados sin cobrar.
 */
export function createFundsReleaseNotifier(
  config: FundsReleaseNotifierConfig,
  deps: { settlementService?: SettlementService } = {}
): FundsReleaseNotifier {
  if (config.FUNDS_RELEASE_NOTIFIER === "payments") {
    if (!deps.settlementService) {
      throw new Error("FUNDS_RELEASE_NOTIFIER=payments requiere un SettlementService");
    }
    return createPaymentsFundsReleaseNotifier(deps.settlementService);
  }
  return createConsoleFundsReleaseNotifier();
}
