import { FundsReleaseNotification, FundsReleaseNotifier } from "./funds-release-notifier";
import { SettlementService } from "../modules/settlements/settlement.service";

/**
 * MOVO-212: la implementación real detrás de `FundsReleaseNotifier` (reemplaza al no-op de
 * MOVO-158 AC7). Al confirmarse el handshake de entrega captura el hold del envío en
 * `movo-svc-payments` y, con el cobro acreditado, lo pasa a `completed`.
 *
 * Si la captura falla propaga el error: el handshake ya está commiteado y lo registra como
 * un warn (best-effort); el envío queda en `delivered` y el barrido de liquidaciones lo
 * reintenta. Nunca revierte la entrega (AC8).
 */
export function createPaymentsFundsReleaseNotifier(settlementService: SettlementService): FundsReleaseNotifier {
  return {
    async notify(input: FundsReleaseNotification): Promise<void> {
      await settlementService.captureAndComplete(input.shipmentId);
    },
  };
}
