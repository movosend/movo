import { createHmac, timingSafeEqual } from "node:crypto";
import { ApiError } from "@movo/shared";

const MAX_TIMESTAMP_SKEW_SECONDS = 300;

/**
 * Serializa un valor JSON con las claves de cada objeto ordenadas alfabéticamente,
 * recursivamente — es el "JSON canónico" contra el que Didit calcula `X-Signature-V2`
 * (HMAC-SHA256), según el spike MOVO-48. El algoritmo exacto de canonicalización de
 * Didit no está confirmado contra un payload real todavía (el spike solo leyó la
 * documentación oficial) — se valida contra el sandbox real en el Paso 7 del plan de
 * MOVO-72 y se ajusta acá si hace falta.
 */
export function canonicalizeJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(record[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function firstHeaderValue(header: string | string[] | undefined): string | undefined {
  return Array.isArray(header) ? header[0] : header;
}

/**
 * Valida el webhook de Didit.me (AC5): firma HMAC-SHA256 sobre el JSON canónico del
 * body, comparación timing-safe, y ventana anti-replay de 5 minutos sobre
 * `X-Timestamp`. Tira `ApiError(401, "KYC_WEBHOOK_INVALID_SIGNATURE", ...)` ante
 * cualquier fallo — un webhook sin firma válida es un endpoint público que le
 * permitiría a cualquiera aprobarse el KYC.
 *
 * Recibe el body CRUDO (`Buffer`), no el objeto ya parseado por Fastify — la firma se
 * calcula sobre los bytes/JSON tal como los mandó Didit, no sobre una reserialización
 * que podría no ser byte-idéntica.
 */
export function verifyDiditSignature(
  rawBody: Buffer,
  signatureHeader: string | string[] | undefined,
  timestampHeader: string | string[] | undefined,
  secret: string
): void {
  const signature = firstHeaderValue(signatureHeader);
  const timestamp = firstHeaderValue(timestampHeader);

  if (!signature || !timestamp) {
    throw new ApiError(401, "KYC_WEBHOOK_INVALID_SIGNATURE", "Firma o timestamp del webhook ausente.");
  }

  const timestampSeconds = Number(timestamp);
  const nowSeconds = Date.now() / 1000;
  if (!Number.isFinite(timestampSeconds) || Math.abs(nowSeconds - timestampSeconds) > MAX_TIMESTAMP_SKEW_SECONDS) {
    throw new ApiError(401, "KYC_WEBHOOK_INVALID_SIGNATURE", "Timestamp del webhook fuera de la ventana permitida.");
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw new ApiError(401, "KYC_WEBHOOK_INVALID_SIGNATURE", "Body del webhook no es JSON válido.");
  }

  const expectedSignature = createHmac("sha256", secret).update(canonicalizeJson(parsedBody)).digest("hex");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  const receivedBuffer = Buffer.from(signature, "utf8");

  // Chequeo de longitud antes de timingSafeEqual (que tira si los buffers difieren en
  // tamaño) — el digest hex de SHA-256 siempre mide 64 caracteres, así que esto solo
  // dispara ante un header malformado, no filtra información sobre el contenido real.
  if (expectedBuffer.length !== receivedBuffer.length || !timingSafeEqual(expectedBuffer, receivedBuffer)) {
    throw new ApiError(401, "KYC_WEBHOOK_INVALID_SIGNATURE", "Firma del webhook inválida.");
  }
}
