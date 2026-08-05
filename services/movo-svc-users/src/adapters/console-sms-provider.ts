import { SmsProvider, buildOtpMessage } from "./sms-provider";

/**
 * Implementación de desarrollo (AC8): loguea el código en vez de mandar un SMS real.
 * Default en dev/test/CI para no incurrir en costos de una API externa de pago — ver
 * riesgo R10 del plan de proyecto y guía del ticket MOVO-71 ("documentar esto como
 * limitación aceptada"). Loguea el mismo texto (`buildOtpMessage`) que mandaría
 * `TwilioSmsProvider`, así en dev se ve exactamente el mensaje real (AC2).
 */
export function createConsoleSmsProvider(): SmsProvider {
  return {
    async send(toE164: string, code: string): Promise<void> {
      console.log(`[ConsoleSmsProvider] Para ${toE164}: ${buildOtpMessage(code)}`);
    },
  };
}
