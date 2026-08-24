import { EmailBody, EmailProvider } from "./email-provider";

const RESEND_SEND_ENDPOINT = "https://api.resend.com/emails";

export interface ResendEmailProviderConfig {
  apiKey: string;
  /** Remitente completo, formato `Nombre <casilla@dominio>` — el dominio tiene que
   * estar verificado en Resend (SPF/DKIM por Terraform en `movo-infra`, ADR-017). */
  from: string;
}

/**
 * Implementación concreta de `EmailProvider` sobre la API HTTP de Resend (ADR-017).
 * Vía `fetch` y no vía el SDK oficial (a diferencia de `twilio-sms-provider.ts`): es
 * un solo POST con un JSON, el SDK no aporta nada acá y sería una dependencia más que
 * mantener — mismo criterio que `telegram-sms-provider.ts` y `expo-push-provider.ts`.
 *
 * Cuesta cuota real (free tier de 3k mails/mes), por eso no es el provider por defecto
 * (ver `console-email-provider.ts`).
 */
export function createResendEmailProvider(config: ResendEmailProviderConfig): EmailProvider {
  return {
    async send(to: string, subject: string, body: EmailBody): Promise<void> {
      const response = await fetch(RESEND_SEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: config.from,
          to: [to],
          subject,
          text: body.text,
          html: body.html,
        }),
      });

      if (!response.ok) {
        // El cuerpo del error de Resend trae `{ name, message }` -- se incluye si se
        // puede leer, pero nunca se deja que un body ilegible tape el status real.
        const detail = await readErrorDetail(response);
        throw new Error(`ResendEmailProvider: fallo al enviar el mail (status ${response.status}${detail})`);
      }
    },
  };
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const parsed: unknown = await response.json();
    if (parsed && typeof parsed === "object" && "message" in parsed) {
      const message = (parsed as { message: unknown }).message;
      if (typeof message === "string") {
        return `: ${message}`;
      }
    }
  } catch {
    // Body vacío o no-JSON: el status por sí solo ya identifica el fallo.
  }
  return "";
}
