import { FundsReleaseNotification, FundsReleaseNotifier } from "./funds-release-notifier";

/**
 * Implementación de desarrollo (AC7 de MOVO-158): loguea la liberación de fondos en
 * vez de disparar una captura/split real de Mercado Pago. Default en dev/test/CI,
 * mismo criterio que `ConsoleSmsProvider`/`ConsoleEmailProvider`.
 */
export function createConsoleFundsReleaseNotifier(): FundsReleaseNotifier {
  return {
    async notify(input: FundsReleaseNotification): Promise<void> {
      console.log(
        `[ConsoleFundsReleaseNotifier] Envío ${input.shipmentId}: liberar fondos al transportista ${input.carrierId}`
      );
    },
  };
}
