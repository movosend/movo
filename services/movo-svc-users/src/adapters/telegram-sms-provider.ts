import { SmsProvider } from "./sms-provider";

export interface TelegramSmsProviderConfig {
  botToken: string;
  chatId: string;
}

/**
 * Implementación de `SmsProvider` (AC8) para el entorno `develop`: en vez de un SMS
 * real, manda el OTP a un grupo de Telegram — evita depender de mirar la consola de
 * EC2 (`ConsoleSmsProvider`) para probar el flujo contra `api-dev.movosend.app`. El
 * texto identifica el teléfono y el código (a diferencia de `buildOtpMessage`, pensado
 * para el usuario final): el destinatario acá es el grupo de devs, no quien pidió el
 * OTP. No usar en `prod` — ahí sigue `TwilioSmsProvider`.
 */
export function createTelegramSmsProvider(config: TelegramSmsProviderConfig): SmsProvider {
  return {
    async send(toE164: string, code: string): Promise<void> {
      const response = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: config.chatId,
          text: `El teléfono ${toE164} solicitó un OTP, es el siguiente: ${code}`,
        }),
      });

      if (!response.ok) {
        throw new Error(`TelegramSmsProvider: fallo al enviar OTP (status ${response.status})`);
      }

      const body = (await response.json()) as { ok: boolean; description?: string };
      if (!body.ok) {
        throw new Error(`TelegramSmsProvider: fallo al enviar OTP (${body.description ?? "sin descripción"})`);
      }
    },
  };
}
