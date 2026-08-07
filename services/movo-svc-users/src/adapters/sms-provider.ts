import { createConsoleSmsProvider } from "./console-sms-provider";
import { createTwilioSmsProvider } from "./twilio-sms-provider";
import { createTelegramSmsProvider } from "./telegram-sms-provider";

/** AC8: interfaz detrás de la que vive el envío de SMS, para poder testear el flujo de
 * OTP sin red y para poder cambiar de proveedor sin tocar `otp-service.ts`. */
export interface SmsProvider {
  send(toE164: string, code: string): Promise<void>;
}

/**
 * AC2: el texto del SMS recuerda explícitamente no compartir el código y que nadie de
 * Movo lo va a pedir — mitiga que alguien reenvíe el código a un tercero que se hace
 * pasar por soporte (vector de ingeniería social típico contra OTP). Centralizado acá
 * para que las dos implementaciones (consola y Twilio) manden exactamente el mismo
 * texto, y se pueda testear una sola vez.
 */
export function buildOtpMessage(code: string): string {
  return (
    `Tu código de verificación de Movo es ${code}. Vence en 10 minutos. ` +
    `No lo compartas con nadie: ningún empleado de Movo te lo va a solicitar.`
  );
}

export interface SmsProviderConfig {
  SMS_PROVIDER: "console" | "twilio" | "telegram";
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_API_KEY_SID?: string;
  TWILIO_API_KEY_SECRET?: string;
  TWILIO_FROM_NUMBER?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
}

/**
 * Selecciona la implementación según `SMS_PROVIDER`. Default de dev/test/CI es
 * "console" (loguea el código, sin costo) — el envío real por Twilio se evalúa solo
 * para la demo final (riesgo R10 del plan de proyecto, ver guía del ticket MOVO-71).
 * Falla rápido al arrancar si se pide Twilio sin credenciales completas, en vez de
 * fallar recién en el primer `send-otp` de un usuario real.
 *
 * Auth vía API Key + Secret (recomendación de Twilio sobre Account SID + Auth Token,
 * ver `twilio-sms-provider.ts`) — el Account SID sigue siendo obligatorio, pero como
 * identificador de cuenta, no como credencial.
 */
export function createSmsProvider(config: SmsProviderConfig): SmsProvider {
  if (config.SMS_PROVIDER === "twilio") {
    if (
      !config.TWILIO_ACCOUNT_SID ||
      !config.TWILIO_API_KEY_SID ||
      !config.TWILIO_API_KEY_SECRET ||
      !config.TWILIO_FROM_NUMBER
    ) {
      throw new Error(
        "SMS_PROVIDER=twilio requiere TWILIO_ACCOUNT_SID, TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET y TWILIO_FROM_NUMBER"
      );
    }
    return createTwilioSmsProvider({
      accountSid: config.TWILIO_ACCOUNT_SID,
      apiKeySid: config.TWILIO_API_KEY_SID,
      apiKeySecret: config.TWILIO_API_KEY_SECRET,
      fromNumber: config.TWILIO_FROM_NUMBER,
    });
  }
  if (config.SMS_PROVIDER === "telegram") {
    if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHAT_ID) {
      throw new Error("SMS_PROVIDER=telegram requiere TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID");
    }
    return createTelegramSmsProvider({
      botToken: config.TELEGRAM_BOT_TOKEN,
      chatId: config.TELEGRAM_CHAT_ID,
    });
  }
  return createConsoleSmsProvider();
}
