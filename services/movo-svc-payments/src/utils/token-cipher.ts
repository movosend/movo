import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Cifrado de los tokens OAuth del transportista en reposo (review de PR #223,
 * MOVO-111). Con el access_token o el refresh_token se opera la cuenta de MP del
 * transportista, y un dump o snapshot de la base (ADR-003) los expondría a todos
 * juntos. AES-256-GCM a nivel aplicación: la key vive en Secrets Manager
 * (`MP_TOKEN_ENCRYPTION_KEY`), nunca en la base.
 *
 * Formato: `v1:<iv>:<authTag>:<ciphertext>`, cada parte en base64url. El prefijo de
 * versión deja lugar para rotar la key sin migrar en bloque (un `v2` convive con
 * `v1` mientras se re-cifra).
 */
const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
// 12 bytes: el tamaño de IV recomendado para GCM (NIST SP 800-38D).
const IV_BYTES = 12;

export class TokenCipherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenCipherError";
  }
}

export interface TokenCipher {
  encrypt(plaintext: string): string;
  decrypt(payload: string): string;
}

/** La key es base64 de 32 bytes. Generarla con `openssl rand -base64 32`. */
export function parseEncryptionKey(raw: string | undefined): Buffer {
  if (!raw) {
    throw new TokenCipherError("MP_TOKEN_ENCRYPTION_KEY no está configurada: cargala en el secret del ambiente.");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new TokenCipherError(`MP_TOKEN_ENCRYPTION_KEY tiene que ser base64 de ${KEY_BYTES} bytes.`);
  }
  return key;
}

/**
 * La key se valida recién al usarla, no al construir: el servicio levanta sin ella en
 * dev/test/CI (mismo criterio que las `MP_*`), y quien la necesita falla explícito.
 */
export function createTokenCipher(rawKey: string | undefined): TokenCipher {
  return {
    encrypt(plaintext) {
      const key = parseEncryptionKey(rawKey);
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, key, iv);
      const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(":");
    },

    decrypt(payload) {
      const key = parseEncryptionKey(rawKey);
      const parts = payload.split(":");
      if (parts.length !== 4 || parts[0] !== VERSION) {
        throw new TokenCipherError("Token cifrado con un formato desconocido");
      }
      const [, iv, tag, ciphertext] = parts.map((part) => Buffer.from(part, "base64url"));
      try {
        const decipher = createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
      } catch {
        // GCM falla si la key es otra o el dato se alteró: no se distingue a propósito.
        throw new TokenCipherError("No se pudo descifrar el token (key distinta o dato alterado)");
      }
    },
  };
}
