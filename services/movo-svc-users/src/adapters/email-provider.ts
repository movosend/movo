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
 * El HTML usa estilos inline y tablas: `<style>` en el head lo descartan varios
 * clientes de correo (Gmail web incluido, para reglas no triviales), y el motor de
 * renderizado de Outlook para Windows es Word — sin flexbox, sin grid y sin
 * `border-radius`, de ahí las tablas anidadas con `bgcolor` en vez de divs.
 *
 * Paleta tomada del manual de marca vía `movo-mobile/tailwind.config.js` (misma fuente
 * de verdad que la app, para que un mail y una pantalla no se vean de dos productos
 * distintos): ink-950 `#0A0A0B`, lime-500 `#C6F24A`, neutros de la escala ink.
 */
const INK_950 = "#0A0A0B";
const INK_700 = "#27272B";
const INK_500 = "#5A5A62";
const INK_150 = "#E6E6EA";
const INK_100 = "#F1F1F3";
const LIME_500 = "#C6F24A";
const PAPER = "#FFFFFF";

/**
 * Wordmark en texto y no una imagen, a propósito: la mayoría de los clientes bloquean
 * imágenes remotas hasta que el usuario las habilita (así que el logo real no se vería
 * en la primera lectura, que es la única que importa en un OTP), un PNG pesado empeora
 * el ratio texto/imagen que miran los filtros de spam, y un `data:` URI directamente lo
 * descartan Gmail y Outlook. Se ve nítido en cualquier densidad de pantalla, sin
 * descargar nada. Ver `CLAUDE.md` de este servicio para el camino del logo real.
 */
function wordmark(): string {
  return (
    `<span style="font-size:22px;font-weight:700;letter-spacing:-0.5px;color:${PAPER};">movo</span>` +
    `<span style="font-size:22px;font-weight:700;color:${LIME_500};">.</span>`
  );
}

/**
 * `preheader` es el texto de vista previa que muestran las bandejas debajo del asunto:
 * sin uno explícito, el cliente agarra el primer texto del cuerpo (en un OTP, terminaba
 * mostrando el código en la lista de mails, a la vista de cualquiera que mire la
 * pantalla). Se oculta con el combo estándar de tamaño 0 + `display:none`.
 */
function wrapHtml(title: string, preheader: string, bodyHtml: string): string {
  return [
    `<div style="margin:0;padding:0;background-color:${INK_100};font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">`,
    `<div style="display:none;font-size:0;line-height:0;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${INK_100}" style="background-color:${INK_100};padding:32px 16px;">`,
    `<tr><td align="center">`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="480" style="width:100%;max-width:480px;background-color:${PAPER};border:1px solid ${INK_150};">`,
    // Cabecera negra con el wordmark: el bloque de marca que pedía el ticket, sin
    // depender de que el cliente descargue una imagen.
    `<tr><td bgcolor="${INK_950}" style="background-color:${INK_950};padding:20px 32px;">${wordmark()}</td></tr>`,
    // Filete lime de 3px: el acento de marca, medido — no hay más lime en el cuerpo
    // salvo el borde del bloque del código.
    `<tr><td bgcolor="${LIME_500}" style="background-color:${LIME_500};font-size:0;line-height:0;height:3px;">&nbsp;</td></tr>`,
    `<tr><td style="padding:32px;">`,
    `<h1 style="margin:0 0 16px;font-size:19px;font-weight:600;line-height:26px;color:${INK_950};">${title}</h1>`,
    bodyHtml,
    `</td></tr>`,
    `<tr><td style="padding:20px 32px;border-top:1px solid ${INK_150};">`,
    `<p style="margin:0;font-size:12px;line-height:18px;color:${INK_500};">Este es un mensaje automático de Movo. No respondas a esta dirección.</p>`,
    `</td></tr></table>`,
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
    "Tu código de verificación vence en 10 minutos.",
    [
      `<p style="margin:0 0 24px;font-size:15px;line-height:22px;color:${INK_700};">Ingresá este código en la app para confirmar tu dirección de correo:</p>`,
      // El código en monoespaciada sobre fondo negro: la app usa JetBrains Mono para
      // datos como este (ver la escala `mono` de tailwind.config.js). Ningún cliente de
      // correo la tiene instalada, así que degrada al monoespaciado del sistema — la
      // intención tipográfica se mantiene igual.
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">`,
      `<tr><td align="center" bgcolor="${INK_950}" style="background-color:${INK_950};border-left:3px solid ${LIME_500};padding:20px 16px;">`,
      `<span style="font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:34px;font-weight:600;letter-spacing:10px;color:${LIME_500};">${code}</span>`,
      `</td></tr></table>`,
      `<p style="margin:24px 0 0;font-size:15px;line-height:22px;color:${INK_700};">Vence en 10 minutos. No lo compartas con nadie: ningún empleado de Movo te lo va a solicitar.</p>`,
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
    "Si no fuiste vos, revisá tu cuenta cuanto antes.",
    [
      `<p style="margin:0 0 16px;font-size:15px;line-height:22px;color:${INK_700};">El email de tu cuenta de Movo se cambió a:</p>`,
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">`,
      `<tr><td bgcolor="${INK_100}" style="background-color:${INK_100};border-left:3px solid ${LIME_500};padding:14px 16px;">`,
      `<span style="font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:15px;color:${INK_950};">${escapeHtml(masked)}</span>`,
      `</td></tr></table>`,
      `<p style="margin:24px 0 0;font-size:15px;line-height:22px;color:${INK_700};">Si no fuiste vos, escribinos cuanto antes: alguien podría tener acceso a tu cuenta.</p>`,
    ].join("")
  );
  return { subject: "Cambiaste el email de tu cuenta de Movo", text, html };
}

/**
 * `maskEmail()` no enmascara el dominio (se muestra tal cual, solo el local-part se
 * oculta) y viaja interpolado directo en el HTML del mail — hay que escaparlo antes:
 * un dominio con metacaracteres HTML no es válido en DNS/SMTP y Resend no lo
 * entregaría, pero no vale la pena confiar en esa restricción externa.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
