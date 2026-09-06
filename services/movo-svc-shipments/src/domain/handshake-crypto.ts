import { webcrypto } from "node:crypto";
import { HandshakeStage } from "../models/handshake";

/**
 * TTL del QR dinámico (AC1/AC5 de MOVO-158) — el cedente puede pedir uno nuevo en
 * cualquier momento, que invalida al anterior (ver `handshake.service.ts`, clave de
 * Redis sobreescrita).
 */
export const HANDSHAKE_QR_TTL_SECONDS = 15;

/**
 * String exacto que el dispositivo del cedente firma client-side (MOVO-159, fuera de
 * este ticket) y que `/confirm` reconstruye para verificar -- ata la firma a este
 * envío+etapa+nonce puntual, así una firma válida no sirve para otro envío/etapa
 * (replay) ni para un nonce distinto (ya vencido/superado). `/generate` nunca firma
 * nada: la clave privada del cedente no sale del dispositivo (MOVO-157 AC1), así que
 * el backend solo puede construir y devolver este string, nunca firmarlo.
 */
export function buildHandshakeCanonicalPayload(shipmentId: string, stage: HandshakeStage, nonce: string): string {
  return `${shipmentId}:${stage}:${nonce}`;
}

/**
 * MOVO-157 acepta tanto base64 estándar como base64url (`^[A-Za-z0-9+/_-]+=*$`) para
 * `publicKey` -- normaliza a base64 estándar antes de decodificar, así la firma/clave
 * llegan en cualquiera de los dos formatos sin que el caller tenga que adivinar cuál.
 *
 * Devuelve un `ArrayBuffer` propio (no una vista sobre el buffer interno de Node) --
 * `BufferSource` de los tipos DOM que usa WebCrypto exige `ArrayBuffer`, y un
 * `Buffer` tipa como `Uint8Array<ArrayBufferLike>` (podría ser un `SharedArrayBuffer`
 * en teoría), que no encaja ahí. El cast final es seguro: `Buffer.from(..., "base64")`
 * nunca devuelve un buffer compartido.
 */
function decodeBase64Lenient(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const buf = Buffer.from(normalized, "base64");
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/**
 * Primera criptografía asimétrica del repo (ADR-020): ECDSA P-256/SHA-256 vía
 * WebCrypto, clave pública en formato `raw` (punto EC sin comprimir, 65 bytes —
 * mismo shape que ya asume MOVO-157) y firma en formato IEEE P1363 (raw r‖s), el
 * nativo de `subtle.sign`/`verify` -- evita reencodear a/desde DER en un extremo,
 * y mantiene el backend en el mismo formato que previsiblemente hablará el mobile
 * (MOVO-159, también WebCrypto). Nunca lanza: una clave o firma malformada (dato de
 * un dispositivo ajeno, fuera de nuestro control) se trata como firma inválida
 * (`false` -> 422 HANDSHAKE_INVALID_SIGNATURE), nunca como un 500.
 */
export async function verifyHandshakeSignature(
  canonicalPayload: string,
  signatureB64: string,
  publicKeyB64: string
): Promise<boolean> {
  try {
    const key = await webcrypto.subtle.importKey(
      "raw",
      decodeBase64Lenient(publicKeyB64),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );
    return await webcrypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      decodeBase64Lenient(signatureB64),
      new TextEncoder().encode(canonicalPayload)
    );
  } catch {
    return false;
  }
}
