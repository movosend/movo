import { createHash, randomBytes } from "node:crypto";
import type Redis from "ioredis";

/**
 * Vida del `state` de OAuth (y su `code_verifier`). Alcanza para loguearse en MP, incluso
 * con un código por SMS o mail. Si se vence, el callback responde
 * `MP_CONNECT_STATE_INVALID` y el transportista vuelve a tocar "Vincular".
 */
export const MP_CONNECT_STATE_TTL_SECONDS = 10 * 60;

const stateKey = (state: string) => `mp_connect_state:${state}`;

export interface PendingAuthorization {
  userId: string;
  codeVerifier: string;
}

export interface MpConnectStateStore {
  /** Genera `state` + PKCE y guarda el verifier atado al usuario. */
  create(userId: string): Promise<{ state: string; codeChallenge: string; expiresAt: Date }>;
  /** Un solo uso: `GETDEL` atómico, un segundo callback con el mismo state recibe `null`. */
  consume(state: string): Promise<PendingAuthorization | null>;
}

/** PKCE S256 (RFC 7636): base64url(sha256(verifier)), sin padding. */
export function pkceChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

export function createMpConnectStateStore(redis: Redis, now: () => Date = () => new Date()): MpConnectStateStore {
  return {
    async create(userId) {
      // 32 bytes → 43 caracteres base64url: dentro del rango 43-128 que exige PKCE.
      const state = randomBytes(32).toString("base64url");
      const codeVerifier = randomBytes(32).toString("base64url");
      const pending: PendingAuthorization = { userId, codeVerifier };
      await redis.set(stateKey(state), JSON.stringify(pending), "EX", MP_CONNECT_STATE_TTL_SECONDS);
      return {
        state,
        codeChallenge: pkceChallenge(codeVerifier),
        expiresAt: new Date(now().getTime() + MP_CONNECT_STATE_TTL_SECONDS * 1000),
      };
    },

    async consume(state) {
      const raw = await redis.getdel(stateKey(state));
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw) as Partial<PendingAuthorization>;
        if (typeof parsed.userId !== "string" || typeof parsed.codeVerifier !== "string") return null;
        return { userId: parsed.userId, codeVerifier: parsed.codeVerifier };
      } catch {
        return null;
      }
    },
  };
}
