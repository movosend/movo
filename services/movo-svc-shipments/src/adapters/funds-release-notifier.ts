import { createConsoleFundsReleaseNotifier } from "./console-funds-release-notifier";

export interface FundsReleaseNotification {
  shipmentId: string;
  /** A quién le corresponde cobrar -- el transportista de este envío. */
  carrierId: string;
}

/**
 * AC7 de MOVO-158: la liberación de fondos REAL (captura/split de Mercado Pago) está
 * deliberadamente descopeada de este ticket -- bloqueada por el caso de soporte
 * escalado con MP. En su lugar, la transición a `delivered` dispara esta interfaz,
 * mismo molde que `SmsProvider`/`EmailProvider` (ADR-012/017): implementación no-op/
 * log en dev-test, la real queda para cuando el ticket de pagos se destrabe.
 */
export interface FundsReleaseNotifier {
  notify(input: FundsReleaseNotification): Promise<void>;
}

export interface FundsReleaseNotifierConfig {
  FUNDS_RELEASE_NOTIFIER: "console";
}

/**
 * Selecciona la implementación según `FUNDS_RELEASE_NOTIFIER`. Único valor hoy es
 * "console" (default) -- el switch existe para no tener que rediseñar el punto de
 * extensión cuando exista una integración real de captura/split.
 */
export function createFundsReleaseNotifier(_config: FundsReleaseNotifierConfig): FundsReleaseNotifier {
  return createConsoleFundsReleaseNotifier();
}
