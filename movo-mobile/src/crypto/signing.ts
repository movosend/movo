import { p256 } from "@noble/curves/nist.js";
import { getOrCreateDeviceKeyPair } from "./keypair";
import { bytesToBase64 } from "./bytes";

/**
 * Firma un `canonicalPayload` de handshake (`{shipmentId}:{stage}:{nonce}`, devuelto
 * por `POST /shipments/:id/handshake/generate`, `svc-shipments`/MOVO-158) con la
 * clave privada del dispositivo -- nunca se manda la privada, solo esta firma.
 *
 * `p256.sign(msg, priv)` (defaults de `@noble/curves`): hashea el mensaje con SHA-256
 * (`prehash: true`) y devuelve la firma en formato `compact` -- 64 bytes `r‖s`, el
 * mismo IEEE P1363 que verifica `webcrypto.subtle.verify({name:"ECDSA",
 * hash:"SHA-256"}, ...)` en `handshake-crypto.ts` (ADR-020). Sin reencodear nada en
 * ningún extremo.
 *
 * Reusable por `MOVO-159` (firma el `canonicalPayload` al generar el QR) y por
 * `MOVO-160` si el diseño técnico de esa pantalla también necesita firmar.
 */
export async function signHandshakeNonce(canonicalPayload: string): Promise<string> {
  const { privateKey } = await getOrCreateDeviceKeyPair();
  const message = new TextEncoder().encode(canonicalPayload);
  const signature = p256.sign(message, privateKey);
  return bytesToBase64(signature);
}
