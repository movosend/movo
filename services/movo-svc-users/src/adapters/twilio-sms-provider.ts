import twilio from "twilio";
import { SmsProvider, buildOtpMessage } from "./sms-provider";

export interface TwilioSmsProviderConfig {
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  fromNumber: string;
}

/**
 * Implementación concreta de `SmsProvider` (AC8) sobre el SDK oficial de Twilio.
 * Decisión documentada en ADR-012 (ver CLAUDE.md) — cuesta dinero real, por eso no es
 * el provider por defecto (ver `console-sms-provider.ts`).
 *
 * Auth vía API Key (recomendación de Twilio) en vez de Account SID + Auth Token: el
 * Auth Token da acceso total a la cuenta y no es revocable sin regenerar todo; una API
 * Key se puede limitar en permisos y revocar sin tocar el resto. El Account SID sigue
 * siendo necesario (identifica la cuenta), pero ya no funciona como credencial — esa
 * función pasa al par SID/Secret de la API Key, pasado como `username`/`password` al
 * constructor del SDK.
 */
/**
 * El "9" que Argentina inserta en el E.164 de un celular (+549XXXXXXXXXX, ver
 * `normalizePhoneToE164Ar` en auth.service.ts) es una convención de marcado para
 * **voz**, no parte del número real — Twilio (y varios operadores) no lo reconocen
 * para SMS: tratan `+549XXXXXXXXXX` como un destinatario distinto de `+54XXXXXXXXXX`,
 * aunque sea la misma línea. Confirmado empíricamente contra la API de Twilio: un
 * número verificado como recipient de cuenta trial devuelve error 572002 ("no es un
 * destinatario verificado") en formato `+549...`, pero pasa ese chequeo en `+54...`
 * (sin el 9). Se remueve el 9 solo acá, al armar el `to` de la llamada a Twilio — la
 * normalización `+549...` de MOVO-70 sigue siendo la forma canónica para
 * unicidad/persistencia, esto es puramente para que el SMS llegue.
 */
function toTwilioRecipient(e164: string): string {
  const match = e164.match(/^\+549(\d{10})$/);
  return match ? `+54${match[1]}` : e164;
}

export function createTwilioSmsProvider(config: TwilioSmsProviderConfig): SmsProvider {
  const client = twilio(config.apiKeySid, config.apiKeySecret, { accountSid: config.accountSid });

  return {
    async send(toE164: string, code: string): Promise<void> {
      await client.messages.create({
        to: toTwilioRecipient(toE164),
        from: config.fromNumber,
        body: buildOtpMessage(code),
      });
    },
    async sendText(toE164: string, message: string): Promise<void> {
      await client.messages.create({
        to: toTwilioRecipient(toE164),
        from: config.fromNumber,
        body: message,
      });
    },
  };
}
