import * as Crypto from "expo-crypto";
import { p256 } from "@noble/curves/nist.js";
import { secureStore, SECURE_STORE_KEYS } from "../lib/secure-store";
import { base64ToBytes, bytesToBase64 } from "./bytes";

export interface DeviceKeyPair {
  privateKey: Uint8Array;
  /** Formato `raw` sin comprimir (65 bytes, `0x04||X||Y`) en base64 estándar --
   * exactamente lo que espera `POST /users/me/device-key` (MOVO-157) y lo que verifica
   * `webcrypto.subtle.importKey("raw", ...)` del lado de `svc-shipments` (MOVO-158,
   * ADR-020). */
  publicKeyBase64: string;
}

/**
 * Par de claves ECDSA P-256 del dispositivo para el handshake criptográfico
 * (MOVO-195, ADR-020). Mismo patrón que `getOrCreateDeviceId()`
 * (`src/lib/device-id.ts`, MOVO-107): si no hay privada persistida se genera una
 * nueva -- eso cubre tanto "dispositivo nuevo" (AC1) como "perdió la clave" por
 * reinstalación/borrado de datos (AC6) con el mismo camino, sin distinguir los dos
 * casos.
 *
 * La privada **nunca** sale de esta función más que como bytes en memoria para firmar
 * (`signing.ts`) -- nunca se loguea, nunca viaja a ningún estado de React/Zustand.
 */
export async function getOrCreateDeviceKeyPair(): Promise<DeviceKeyPair> {
  const existing = await secureStore.getItem(SECURE_STORE_KEYS.handshakeDevicePrivateKey);
  const privateKey = existing ? base64ToBytes(existing) : await generateAndPersistPrivateKey();
  return { privateKey, publicKeyBase64: bytesToBase64(p256.getPublicKey(privateKey, false)) };
}

/**
 * 32 bytes random de `expo-crypto` (no `p256.utils.randomSecretKey()` directo --
 * mismo motivo que ya documentó `device-id.ts` para el `deviceId`: evita depender de
 * que `globalThis.crypto.getRandomValues` esté poblado en Hermes/RN). La probabilidad
 * de que 32 bytes random no sean un escalar válido para P-256 es astronómicamente baja
 * (~2^-32), pero se valida en vez de asumirlo ciegamente -- reintenta si no.
 */
async function generateAndPersistPrivateKey(): Promise<Uint8Array> {
  let candidate: Uint8Array;
  do {
    candidate = await Crypto.getRandomBytesAsync(32);
  } while (!p256.utils.isValidSecretKey(candidate));

  await secureStore.setItem(SECURE_STORE_KEYS.handshakeDevicePrivateKey, bytesToBase64(candidate));
  return candidate;
}
