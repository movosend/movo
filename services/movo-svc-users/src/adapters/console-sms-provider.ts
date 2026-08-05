import { SmsProvider } from "./sms-provider";

/**
 * Implementación de desarrollo (AC8): loguea el código en vez de mandar un SMS real.
 * Default en dev/test/CI para no incurrir en costos de una API externa de pago — ver
 * riesgo R10 del plan de proyecto y guía del ticket MOVO-71 ("documentar esto como
 * limitación aceptada").
 */
export function createConsoleSmsProvider(): SmsProvider {
  return {
    async send(toE164: string, code: string): Promise<void> {
      console.log(`[ConsoleSmsProvider] OTP para ${toE164}: ${code}`);
    },
  };
}
