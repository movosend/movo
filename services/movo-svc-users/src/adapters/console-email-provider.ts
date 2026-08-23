import { EmailBody, EmailProvider } from "./email-provider";

/**
 * Implementación de desarrollo (AC1 de MOVO-139): loguea el mail en vez de mandarlo.
 * Default en dev/test/CI, mismo criterio que `console-sms-provider.ts` — no depende de
 * un dominio verificado en Resend ni de `RESEND_API_KEY` para levantar el servicio.
 *
 * Loguea solo la parte de texto plano: el HTML es ruido ilegible en una consola, y las
 * dos partes las arma la misma función (`buildOtpEmail`/`buildEmailChangedNotice`), así
 * que ver una alcanza para saber qué se mandó.
 */
export function createConsoleEmailProvider(): EmailProvider {
  return {
    async send(to: string, subject: string, body: EmailBody): Promise<void> {
      console.log(`[ConsoleEmailProvider] Para ${to} | ${subject}: ${body.text}`);
    },
  };
}
