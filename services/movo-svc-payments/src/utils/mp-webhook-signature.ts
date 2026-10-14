import { createHmac, timingSafeEqual } from "node:crypto";

export interface MpWebhookSignatureInput {
  /** Header `x-signature` tal cual: `ts=<epoch>,v1=<hmac hex>`. */
  signatureHeader: string | undefined;
  /** Header `x-request-id` de la notificación. */
  requestId: string | undefined;
  /** `data.id` del query string de la notificación (el id del pago). */
  dataId: string | undefined;
  secret: string;
}

/** Partes del header `x-signature`. Devuelve `null` si falta `ts` o `v1`. */
export function parseSignatureHeader(header: string): { ts: string; v1: string } | null {
  let ts: string | undefined;
  let v1: string | undefined;
  for (const part of header.split(",")) {
    const [rawKey, ...rest] = part.split("=");
    const key = rawKey?.trim();
    const value = rest.join("=").trim();
    if (key === "ts") ts = value;
    if (key === "v1") v1 = value;
  }
  return ts && v1 ? { ts, v1 } : null;
}

/**
 * Manifest que firma MP: `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`. Un valor que
 * no vino se omite junto con su clave (documentación de MP). Si `data.id` es alfanumérico
 * MP lo firma en minúscula.
 */
export function buildSignatureManifest(dataId: string | undefined, requestId: string | undefined, ts: string): string {
  let manifest = "";
  if (dataId) manifest += `id:${/^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${ts};`;
  return manifest;
}

/**
 * MOVO-268 AC2: valida `x-signature` con la clave secreta de webhooks de la app
 * (`MP_WEBHOOK_SECRET`). Solo HMAC, sin ventana sobre `ts`: un reintento legítimo de MP
 * conserva el `ts` original y rechazarlo perdería la notificación. Un reenvío malicioso de una
 * notificación vieja es inofensivo porque el inbox deduplica por lo que SÍ está firmado
 * (`notificationDedupeKey`: pago + `x-request-id` + `ts`), no por el `id` del body, y porque el
 * servicio nunca actúa sobre el body sino sobre `Payment.get`.
 */
export function verifyMpWebhookSignature(input: MpWebhookSignatureInput): boolean {
  if (!input.signatureHeader) return false;
  const parsed = parseSignatureHeader(input.signatureHeader);
  if (!parsed) return false;

  const expected = createHmac("sha256", input.secret)
    .update(buildSignatureManifest(input.dataId, input.requestId, parsed.ts))
    .digest();
  if (!/^[0-9a-f]+$/i.test(parsed.v1)) return false;
  const received = Buffer.from(parsed.v1, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/**
 * Clave de deduplicación de una notificación, armada SOLO con lo que firma MP (`data.id`,
 * `x-request-id` y `ts`). El `id` del body no está firmado: quien tuviera una notificación válida podía
 * reenviarla con otro `id` y crear una fila nueva en el inbox cada vez.
 */
export function notificationDedupeKey(dataId: string, requestId: string | undefined, ts: string): string {
  return `${dataId.toLowerCase()}:${requestId ?? "-"}:${ts}`;
}
