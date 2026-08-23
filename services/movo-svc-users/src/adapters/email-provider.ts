import { createConsoleEmailProvider } from "./console-email-provider";
import { createResendEmailProvider } from "./resend-email-provider";

/**
 * MOVO-139 / ADR-017: espejo exacto de `sms-provider.ts` (ADR-012) — interfaz +
 * factory por env var + implementación de consola como default de dev/test/CI +
 * proveedor real (Resend) reservado para la demo.
 *
 * A diferencia de `SmsProvider.send(to, code)`, acá el cuerpo viaja como
 * `{ text, html }` y no como un string pelado: un mail transaccional sin parte de
 * texto plano es un clásico disparador de filtros de spam, y sin HTML se ve roto en
 * la mayoría de los clientes. Los dos los arman las funciones `build*Email` de este
 * mismo archivo, así que ninguna implementación decide el contenido por su cuenta.
 */
export interface EmailBody {
  text: string;
  html: string;
}

export interface EmailProvider {
  send(to: string, subject: string, body: EmailBody): Promise<void>;
}

export interface EmailMessage extends EmailBody {
  subject: string;
}

/**
 * Los templates viven acá, en código, y no en la UI de Resend a propósito: los
 * "Templates" de Resend son para Broadcasts, no se versionan en el repo, no se pueden
 * testear y atarían el contenido al proveedor — justo lo que esta interfaz existe para
 * evitar. Sin librería de templating ni MJML: dos mails no justifican la dependencia.
 *
 * El HTML usa estilos inline y una tabla de un solo ancho: `<style>` en el head lo
 * descartan varios clientes de correo (Gmail web incluido, para reglas no triviales).
 */
function wrapHtml(title: string, bodyHtml: string): string {
  return [
    `<div style="margin:0;padding:24px;background-color:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:480px;margin:0 auto;background-color:#ffffff;border-radius:12px;">`,
    `<tr><td style="padding:32px;">`,
    `<p style="margin:0 0 24px;font-size:20px;font-weight:700;color:#111111;">Movo</p>`,
    `<h1 style="margin:0 0 16px;font-size:18px;font-weight:600;color:#111111;">${title}</h1>`,
    bodyHtml,
    `<p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#888888;">Este es un mensaje automático de Movo. No respondas a esta dirección.</p>`,
    `</td></tr></table></div>`,
  ].join("");
}

/**
 * Mismo criterio que `buildOtpMessage` de `sms-provider.ts` (AC2 de MOVO-71): el texto
 * recuerda explícitamente no compartir el código y que nadie de Movo lo va a pedir —
 * mitiga el vector de ingeniería social típico contra OTP. Centralizado acá para que
 * consola y Resend manden exactamente el mismo contenido.
 */
export function buildOtpEmail(code: string): EmailMessage {
  const text =
    `Tu código de verificación de Movo es ${code}. Vence en 10 minutos. ` +
    `No lo compartas con nadie: ningún empleado de Movo te lo va a solicitar.`;
  const html = wrapHtml(
    "Verificá tu email",
    [
      `<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#333333;">Ingresá este código en la app para confirmar tu dirección de correo:</p>`,
      `<p style="margin:0 0 16px;font-size:32px;font-weight:700;letter-spacing:6px;color:#111111;">${code}</p>`,
      `<p style="margin:0;font-size:14px;line-height:1.6;color:#333333;">Vence en 10 minutos. No lo compartas con nadie: ningún empleado de Movo te lo va a solicitar.</p>`,
    ].join("")
  );
  return { subject: "Tu código de verificación de Movo", text, html };
}

/**
 * AC5: aviso al email ANTERIOR cuando el usuario cambia su dirección. Es el mail que
 * cierra la limitación documentada en `services/movo-svc-users/CLAUDE.md` ("sin
 * EmailProvider no se puede notificar al email anterior"): sirve para que el dueño
 * real de la cuenta se entere si el cambio no lo hizo él.
 *
 * El email nuevo se muestra parcialmente enmascarado: este mail va a una casilla que
 * a partir de ahora ya no pertenece a la cuenta, así que no corresponde revelarle la
 * dirección completa de la nueva.
 */
export function buildEmailChangedNotice(newEmail: string): EmailMessage {
  const masked = maskEmail(newEmail);
  const text =
    `El email de tu cuenta de Movo se cambió a ${masked}. ` +
    `Si no fuiste vos, escribinos cuanto antes: alguien podría tener acceso a tu cuenta.`;
  const html = wrapHtml(
    "Cambiaste el email de tu cuenta",
    [
      `<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#333333;">El email de tu cuenta de Movo se cambió a <strong>${masked}</strong>.</p>`,
      `<p style="margin:0;font-size:14px;line-height:1.6;color:#333333;">Si no fuiste vos, escribinos cuanto antes: alguien podría tener acceso a tu cuenta.</p>`,
    ].join("")
  );
  return { subject: "Cambiaste el email de tu cuenta de Movo", text, html };
}

/** `juan.perez@gmail.com` -> `j****z@gmail.com`. Direcciones muy cortas quedan
 * enmascaradas del todo (`a@x.com` -> `*@x.com`) en vez de exponer su único carácter. */
function maskEmail(email: string): string {
  const atIndex = email.lastIndexOf("@");
  if (atIndex <= 0) {
    return "***";
  }
  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex);
  if (local.length <= 2) {
    return `${"*".repeat(local.length)}${domain}`;
  }
  return `${local[0]}${"*".repeat(local.length - 2)}${local[local.length - 1]}${domain}`;
}

export interface EmailProviderConfig {
  EMAIL_PROVIDER: "console" | "resend";
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
}

/**
 * Selecciona la implementación según `EMAIL_PROVIDER`. Default de dev/test/CI es
 * "console" (loguea el mail, sin red ni costo) — mismo criterio que `SMS_PROVIDER`,
 * `DIDIT_MODE`, `GEOCODING_PROVIDER` y `STORAGE_PROVIDER`. Falla rápido al arrancar si
 * se pide Resend sin credenciales, en vez de fallar recién en el primer envío de un
 * usuario real (AC1).
 */
export function createEmailProvider(config: EmailProviderConfig): EmailProvider {
  if (config.EMAIL_PROVIDER === "resend") {
    if (!config.RESEND_API_KEY || !config.EMAIL_FROM) {
      throw new Error("EMAIL_PROVIDER=resend requiere RESEND_API_KEY y EMAIL_FROM");
    }
    return createResendEmailProvider({
      apiKey: config.RESEND_API_KEY,
      from: config.EMAIL_FROM,
    });
  }
  return createConsoleEmailProvider();
}
