import Redis from "ioredis";
import { PANEL_ACCESS_TOKEN_TTL_SECONDS } from "@movo/shared";

export const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days (7776000s), ADR-013

/** TTL del access token (ADR-004) — mismo valor que `ACCESS_TOKEN_TTL` en
 * `shared/movo-shared/src/auth/jwt.ts`, duplicado acá porque esa constante no se
 * exporta en segundos. Marca hasta cuándo puede quedar viva la marca de revocación
 * de `revokeAccessTokensIssuedBefore` -- pasado ese tiempo, todo access token emitido
 * antes ya expiró por su cuenta y la key es redundante. */
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;

export type ConsumeRefreshTokenResult = "ok" | "already-used" | "hash-mismatch" | "not-found";

/**
 * MOVO-287: además del resultado, el consumo de un refresh de panel devuelve el
 * vencimiento absoluto de la sesión (segundos Unix), que se fijó al crearla y se copia
 * tal cual en cada rotación -- así rotar nunca extiende las 8 h.
 */
export type ConsumePanelRefreshTokenResult =
  | { status: "ok"; absoluteExpiresAt: number }
  | { status: Exclude<ConsumeRefreshTokenResult, "ok"> };

export interface PanelRefreshTokenRecord {
  hash: string;
  /** Segundos Unix. */
  absoluteExpiresAt: number;
}

export interface SessionRepository {
  saveRefreshToken(
    userId: string,
    tokenId: string,
    payload?: string | Record<string, unknown>,
    ttlSeconds?: number
  ): Promise<void>;
  findRefreshToken(userId: string, tokenId: string): Promise<string | null>;
  /**
   * Lee el registro `{ hash, used }` de `refresh:{userId}:{tokenId}` y, si
   * `expectedHash` matchea y todavía no fue usado, lo marca `used: true` —
   * todo en una sola operación Redis (script Lua, mismo patrón que
   * `otp-repository.ts#incrementAttempts`). Sin esto, un `findRefreshToken` +
   * chequeo de `used` + `saveRefreshToken` separados dejan una carrera: dos
   * refresh concurrentes con el mismo token válido pueden pasar el chequeo
   * `used === false` antes de que cualquiera escriba `used: true`, y ninguno
   * dispara la detección de reuso del AC3.
   */
  consumeRefreshToken(userId: string, tokenId: string, expectedHash: string): Promise<ConsumeRefreshTokenResult>;
  revokeRefreshToken(userId: string, tokenId: string): Promise<boolean>;
  /**
   * Revoca TODAS las sesiones del usuario, de la app y del panel (MOVO-287): la usan los
   * eventos de seguridad de la cuenta (cambio de contraseña, baja, reuso de un refresh).
   */
  revokeAllForUser(userId: string): Promise<number>;
  /**
   * MOVO-287: las sesiones del panel viven en su propio namespace
   * (`panel-refresh:{userId}:{tokenId}`), separado de las de la app (`refresh:*`). El TTL
   * de la key es lo que le queda a la sesión hasta `absoluteExpiresAt`.
   */
  savePanelRefreshToken(userId: string, tokenId: string, record: PanelRefreshTokenRecord): Promise<void>;
  /** Mismo consumo atómico que `consumeRefreshToken`, sobre el namespace del panel. */
  consumePanelRefreshToken(userId: string, tokenId: string, expectedHash: string): Promise<ConsumePanelRefreshTokenResult>;
  revokePanelRefreshToken(userId: string, tokenId: string): Promise<boolean>;
  /**
   * Corte inmediato del panel (AC7 de MOVO-287) sin tocar las sesiones de la app: borra
   * todos los refresh de panel del usuario y sella `panel-revoked-at:{userId}`, que el
   * gateway compara contra el `iat` de cualquier access token que traiga `admin` (mismo
   * criterio de segundos Unix que `revokeAccessTokensIssuedBefore`). TTL = TTL del access
   * token de panel: pasado ese tiempo, todo token emitido antes ya venció solo.
   */
  revokePanelSessionsForUser(userId: string): Promise<number>;
  /**
   * Sella `user-revoked-at:{userId}` con el instante actual, en segundos Unix -- misma
   * unidad que el claim `iat` de un JWT (RFC 7519), a propósito: si se guardara en
   * milisegundos (`Date.now()`), el access token nuevo que `changePassword()` emite
   * milisegundos después podría quedar con `iat` (truncado al segundo) por debajo del
   * corte y auto-revocarse. TTL = `ACCESS_TOKEN_TTL_SECONDS`, la key se limpia sola.
   * El gateway (`plugins/auth.ts`) lo lee en cada request autenticado y rechaza
   * cualquier access token cuyo `iat` sea anterior -- sin esto, `revokeAllForUser`
   * solo invalida refresh tokens, pero el access token ya emitido (JWT stateless,
   * ADR-004) sigue siendo válido hasta sus 60 minutos de TTL, sobreviviendo tanto a un
   * cambio de contraseña como a una baja de cuenta.
   */
  revokeAccessTokensIssuedBefore(userId: string): Promise<void>;
}

// GET + cjson.decode + chequeo de `used` + SET atómico: sin esto, leer y escribir por
// llamadas Redis separadas deja una ventana entre el chequeo `used === false` y la
// escritura donde dos refresh concurrentes con el mismo token pueden pasar los dos.
// KEEPTTL preserva el TTL de la key — un SET sin esa opción lo resetearía.
// Devuelve `{ status, absoluteExpiresAt }`: el segundo campo solo lo tienen las sesiones
// de panel (MOVO-287), las de la app devuelven "".
const CONSUME_REFRESH_TOKEN_SCRIPT = `
local val = redis.call("GET", KEYS[1])
if not val then
  return { "not-found", "" }
end
local record = cjson.decode(val)
if record.hash ~= ARGV[1] then
  return { "hash-mismatch", "" }
end
if record.used then
  return { "already-used", "" }
end
record.used = true
redis.call("SET", KEYS[1], cjson.encode(record), "KEEPTTL")
local absoluteExpiresAt = ""
if record.absoluteExpiresAt then
  absoluteExpiresAt = tostring(record.absoluteExpiresAt)
end
return { "ok", absoluteExpiresAt }
`;

export function createSessionRepository(redis: Redis): SessionRepository {
  const validateIds = (userId: string, tokenId: string): void => {
    if (userId.includes(":") || tokenId.includes(":")) {
      throw new Error("userId and tokenId cannot contain colons");
    }
  };

  const buildKey = (userId: string, tokenId: string): string => `refresh:${userId}:${tokenId}`;
  const buildPanelKey = (userId: string, tokenId: string): string => `panel-refresh:${userId}:${tokenId}`;

  const consume = async (key: string, expectedHash: string): Promise<[ConsumeRefreshTokenResult, string]> => {
    const [status, absoluteExpiresAt] = (await redis.eval(CONSUME_REFRESH_TOKEN_SCRIPT, 1, key, expectedHash)) as [
      ConsumeRefreshTokenResult,
      string,
    ];
    return [status, absoluteExpiresAt];
  };

  /** SCAN + UNLINK de todas las keys de un patrón. Devuelve cuántas borró. */
  const scanAndUnlink = async (pattern: string): Promise<number> => {
    let cursor = "0";
    let totalDeleted = 0;
    do {
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        totalDeleted += await redis.unlink(...keys);
      }
    } while (cursor !== "0");
    return totalDeleted;
  };

  // Escape special glob pattern characters in userId (\, *, ?, [, ]) to prevent glob injection
  const escapeGlob = (value: string): string => value.replace(/[\*?\[\]\\]/g, "\\$&");

  return {
    async saveRefreshToken(
      userId: string,
      tokenId: string,
      payload: string | Record<string, unknown> = "true",
      ttlSeconds: number = DEFAULT_REFRESH_TOKEN_TTL_SECONDS
    ): Promise<void> {
      if (!userId || !tokenId) {
        throw new Error("userId and tokenId are required to save refresh token");
      }
      validateIds(userId, tokenId);

      const key = buildKey(userId, tokenId);
      const val = typeof payload === "object" ? JSON.stringify(payload) : payload;
      const validTtl = Math.max(1, Math.floor(ttlSeconds));

      await redis.set(key, val, "EX", validTtl);
    },

    async findRefreshToken(userId: string, tokenId: string): Promise<string | null> {
      if (!userId || !tokenId) {
        return null;
      }
      if (userId.includes(":") || tokenId.includes(":")) {
        return null;
      }
      const key = buildKey(userId, tokenId);
      return await redis.get(key);
    },

    async consumeRefreshToken(
      userId: string,
      tokenId: string,
      expectedHash: string
    ): Promise<ConsumeRefreshTokenResult> {
      if (!userId || !tokenId) {
        return "not-found";
      }
      validateIds(userId, tokenId);

      const [status] = await consume(buildKey(userId, tokenId), expectedHash);
      return status;
    },

    async revokeRefreshToken(userId: string, tokenId: string): Promise<boolean> {
      if (!userId || !tokenId) {
        return false;
      }
      if (userId.includes(":") || tokenId.includes(":")) {
        return false;
      }
      const key = buildKey(userId, tokenId);
      const count = await redis.unlink(key);
      return count > 0;
    },

    async revokeAllForUser(userId: string): Promise<number> {
      if (!userId) {
        return 0;
      }
      if (userId.includes(":")) {
        throw new Error("userId cannot contain colons");
      }

      const sanitizedUserId = escapeGlob(userId);
      const appSessions = await scanAndUnlink(`refresh:${sanitizedUserId}:*`);
      const panelSessions = await scanAndUnlink(`panel-refresh:${sanitizedUserId}:*`);
      return appSessions + panelSessions;
    },

    async savePanelRefreshToken(userId: string, tokenId: string, record: PanelRefreshTokenRecord): Promise<void> {
      if (!userId || !tokenId) {
        throw new Error("userId and tokenId are required to save refresh token");
      }
      validateIds(userId, tokenId);

      const remainingSeconds = record.absoluteExpiresAt - Math.floor(Date.now() / 1000);
      if (remainingSeconds <= 0) {
        throw new Error("panel session already expired");
      }
      await redis.set(
        buildPanelKey(userId, tokenId),
        JSON.stringify({ hash: record.hash, used: false, absoluteExpiresAt: record.absoluteExpiresAt }),
        "EX",
        remainingSeconds
      );
    },

    async consumePanelRefreshToken(
      userId: string,
      tokenId: string,
      expectedHash: string
    ): Promise<ConsumePanelRefreshTokenResult> {
      if (!userId || !tokenId) {
        return { status: "not-found" };
      }
      validateIds(userId, tokenId);

      const [status, absoluteExpiresAt] = await consume(buildPanelKey(userId, tokenId), expectedHash);
      if (status !== "ok") {
        return { status };
      }
      const parsed = Number(absoluteExpiresAt);
      if (!absoluteExpiresAt || !Number.isFinite(parsed)) {
        // Un registro de panel sin vencimiento absoluto no debería existir (solo esta
        // capa los escribe) -- se trata como inexistente en vez de inventar un plazo.
        return { status: "not-found" };
      }
      return { status: "ok", absoluteExpiresAt: parsed };
    },

    async revokePanelRefreshToken(userId: string, tokenId: string): Promise<boolean> {
      if (!userId || !tokenId || userId.includes(":") || tokenId.includes(":")) {
        return false;
      }
      const count = await redis.unlink(buildPanelKey(userId, tokenId));
      return count > 0;
    },

    async revokePanelSessionsForUser(userId: string): Promise<number> {
      if (!userId || userId.includes(":")) {
        throw new Error("userId is required and cannot contain colons");
      }
      const deleted = await scanAndUnlink(`panel-refresh:${escapeGlob(userId)}:*`);
      const nowSeconds = Math.floor(Date.now() / 1000);
      await redis.set(`panel-revoked-at:${userId}`, nowSeconds, "EX", PANEL_ACCESS_TOKEN_TTL_SECONDS);
      return deleted;
    },

    async revokeAccessTokensIssuedBefore(userId: string): Promise<void> {
      if (!userId || userId.includes(":")) {
        throw new Error("userId is required and cannot contain colons");
      }
      const nowSeconds = Math.floor(Date.now() / 1000);
      await redis.set(`user-revoked-at:${userId}`, nowSeconds, "EX", ACCESS_TOKEN_TTL_SECONDS);
    },
  };
}
