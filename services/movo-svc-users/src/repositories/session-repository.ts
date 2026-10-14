import Redis from "ioredis";
import { ACCESS_TOKEN_TTL_SECONDS, PANEL_ACCESS_TOKEN_TTL_SECONDS, PANEL_SESSION_TTL_SECONDS } from "@movo/shared";

export const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days (7776000s), ADR-013

export type ConsumeRefreshTokenResult = "ok" | "already-used" | "hash-mismatch" | "not-found";

/**
 * MOVO-287: además del resultado, el consumo de un refresh de panel devuelve el
 * vencimiento absoluto de la sesión (segundos Unix), que se fijó al crearla y se copia
 * tal cual en cada rotación -- así rotar nunca extiende las 8 h.
 */
export type ConsumePanelRefreshTokenResult =
  | { status: "ok"; absoluteExpiresAt: number }
  | { status: Exclude<ConsumeRefreshTokenResult, "ok"> };

/**
 * Resultado de guardar un refresh de panel (review de PR #244). `expired`: la sesión llegó a
 * sus 8 h entre que se leyó y se guarda. `revoked`: se cortaron las sesiones de panel del
 * usuario después de que esta sesión arrancó. Los dos se responden como 401, nunca 500.
 */
export type SavePanelRefreshTokenResult = "ok" | "expired" | "revoked";

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
   * dispara la detección de reuso del AC3. Ids con `:` (token armado a mano) → `not-found`.
   */
  consumeRefreshToken(userId: string, tokenId: string, expectedHash: string): Promise<ConsumeRefreshTokenResult>;
  revokeRefreshToken(userId: string, tokenId: string): Promise<boolean>;
  /**
   * Revoca todas las sesiones de la APP del usuario (reuso de un refresh, logout-all,
   * cuenta suspendida). No toca las del panel (review de PR #244): los eventos de seguridad
   * de la cuenta que sí deben cortarlo (cambio o reset de contraseña, baja) llaman además a
   * `revokePanelSessionsForUser`.
   */
  revokeAllForUser(userId: string): Promise<number>;
  /**
   * MOVO-287: las sesiones del panel viven en su propio namespace
   * (`panel-refresh:{userId}:{tokenId}`), separado de las de la app (`refresh:*`). El TTL
   * de la key es lo que le queda a la sesión hasta `absoluteExpiresAt`. No guarda nada si
   * la sesión ya venció o si fue revocada después de arrancar (ver
   * `SavePanelRefreshTokenResult`).
   */
  savePanelRefreshToken(userId: string, tokenId: string, record: PanelRefreshTokenRecord): Promise<SavePanelRefreshTokenResult>;
  /** Mismo consumo atómico que `consumeRefreshToken`, sobre el namespace del panel. */
  consumePanelRefreshToken(userId: string, tokenId: string, expectedHash: string): Promise<ConsumePanelRefreshTokenResult>;
  revokePanelRefreshToken(userId: string, tokenId: string): Promise<boolean>;
  /**
   * Corte inmediato del panel (AC7 de MOVO-287) sin tocar las sesiones de la app: sella
   * `panel-revoked-at:{userId}` y recién después borra todos los refresh de panel del
   * usuario. El gateway rechaza todo token de panel con `iat <=` la marca, y
   * `savePanelRefreshToken` rechaza guardar el refresh de una sesión que arrancó antes: así
   * un refresh o verify en paralelo no sobrevive al barrido (review de PR #244). TTL de la
   * marca = TTL del access token de panel: pasado ese tiempo, todo token emitido antes ya
   * venció solo (y ningún refresh anterior sigue guardado).
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

// Guarda el refresh de panel solo si la sesión no fue revocada después de arrancar: leer la
// marca y escribir en un solo paso cierra la carrera con `revokePanelSessionsForUser`, que
// escribe la marca antes de barrer. KEYS[1] = refresh, KEYS[2] = `panel-revoked-at`;
// ARGV = valor, TTL, inicio de la sesión (segundos Unix).
const SAVE_PANEL_REFRESH_TOKEN_SCRIPT = `
local revokedAt = redis.call("GET", KEYS[2])
if revokedAt and tonumber(revokedAt) >= tonumber(ARGV[3]) then
  return "revoked"
end
redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[2])
return "ok"
`;

/** Namespaces de los refresh tokens: la app (`refresh:*`) y el panel (`panel-refresh:*`, MOVO-287). */
type RefreshNamespace = "refresh" | "panel-refresh";

/** Los ids arman la key de Redis: un `:` la rompería (y un token armado a mano puede traerlo). */
function validIds(userId: string, tokenId: string): boolean {
  return Boolean(userId) && Boolean(tokenId) && !userId.includes(":") && !tokenId.includes(":");
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function createSessionRepository(redis: Redis): SessionRepository {
  const buildKey = (namespace: RefreshNamespace, userId: string, tokenId: string): string =>
    `${namespace}:${userId}:${tokenId}`;
  const panelRevokedAtKey = (userId: string): string => `panel-revoked-at:${userId}`;

  // Escape special glob pattern characters in userId (\, *, ?, [, ]) to prevent glob injection
  const escapeGlob = (value: string): string => value.replace(/[\*?\[\]\\]/g, "\\$&");

  /** Consumo atómico sobre cualquier namespace. Ids inválidos → `not-found`, nunca un 500. */
  const consume = async (
    namespace: RefreshNamespace,
    userId: string,
    tokenId: string,
    expectedHash: string
  ): Promise<[ConsumeRefreshTokenResult, string]> => {
    if (!validIds(userId, tokenId)) {
      return ["not-found", ""];
    }
    const [status, absoluteExpiresAt] = (await redis.eval(
      CONSUME_REFRESH_TOKEN_SCRIPT,
      1,
      buildKey(namespace, userId, tokenId),
      expectedHash
    )) as [ConsumeRefreshTokenResult, string];
    return [status, absoluteExpiresAt];
  };

  const revokeOne = async (namespace: RefreshNamespace, userId: string, tokenId: string): Promise<boolean> => {
    if (!validIds(userId, tokenId)) {
      return false;
    }
    return (await redis.unlink(buildKey(namespace, userId, tokenId))) > 0;
  };

  /** SCAN + UNLINK de todas las sesiones de un namespace. Devuelve cuántas borró. */
  const revokeNamespace = async (namespace: RefreshNamespace, userId: string): Promise<number> => {
    const pattern = `${namespace}:${escapeGlob(userId)}:*`;
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

  const assertValidUserId = (userId: string): void => {
    if (!userId || userId.includes(":")) {
      throw new Error("userId is required and cannot contain colons");
    }
  };

  return {
    async saveRefreshToken(
      userId: string,
      tokenId: string,
      payload: string | Record<string, unknown> = "true",
      ttlSeconds: number = DEFAULT_REFRESH_TOKEN_TTL_SECONDS
    ): Promise<void> {
      // Los ids los genera el servidor: uno inválido acá es un bug, no un input del cliente.
      if (!validIds(userId, tokenId)) {
        throw new Error("userId and tokenId are required and cannot contain colons");
      }
      const val = typeof payload === "object" ? JSON.stringify(payload) : payload;
      const validTtl = Math.max(1, Math.floor(ttlSeconds));
      await redis.set(buildKey("refresh", userId, tokenId), val, "EX", validTtl);
    },

    async findRefreshToken(userId: string, tokenId: string): Promise<string | null> {
      if (!validIds(userId, tokenId)) {
        return null;
      }
      return await redis.get(buildKey("refresh", userId, tokenId));
    },

    async consumeRefreshToken(userId: string, tokenId: string, expectedHash: string): Promise<ConsumeRefreshTokenResult> {
      const [status] = await consume("refresh", userId, tokenId, expectedHash);
      return status;
    },

    revokeRefreshToken(userId: string, tokenId: string): Promise<boolean> {
      return revokeOne("refresh", userId, tokenId);
    },

    async revokeAllForUser(userId: string): Promise<number> {
      if (!userId) {
        return 0;
      }
      if (userId.includes(":")) {
        throw new Error("userId cannot contain colons");
      }
      return revokeNamespace("refresh", userId);
    },

    async savePanelRefreshToken(
      userId: string,
      tokenId: string,
      record: PanelRefreshTokenRecord
    ): Promise<SavePanelRefreshTokenResult> {
      if (!validIds(userId, tokenId)) {
        throw new Error("userId and tokenId are required and cannot contain colons");
      }

      const remainingSeconds = record.absoluteExpiresAt - nowSeconds();
      if (remainingSeconds <= 0) {
        return "expired";
      }
      // La sesión arrancó 8 h antes de su vencimiento absoluto (se fija al hacer login y
      // nunca se mueve): cualquier revocación posterior a ese instante la mata.
      const sessionStartedAt = record.absoluteExpiresAt - PANEL_SESSION_TTL_SECONDS;
      return (await redis.eval(
        SAVE_PANEL_REFRESH_TOKEN_SCRIPT,
        2,
        buildKey("panel-refresh", userId, tokenId),
        panelRevokedAtKey(userId),
        JSON.stringify({ hash: record.hash, used: false, absoluteExpiresAt: record.absoluteExpiresAt }),
        remainingSeconds,
        sessionStartedAt
      )) as SavePanelRefreshTokenResult;
    },

    async consumePanelRefreshToken(
      userId: string,
      tokenId: string,
      expectedHash: string
    ): Promise<ConsumePanelRefreshTokenResult> {
      const [status, absoluteExpiresAt] = await consume("panel-refresh", userId, tokenId, expectedHash);
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

    revokePanelRefreshToken(userId: string, tokenId: string): Promise<boolean> {
      return revokeOne("panel-refresh", userId, tokenId);
    },

    async revokePanelSessionsForUser(userId: string): Promise<number> {
      assertValidUserId(userId);
      // La marca primero: un refresh que se guarde mientras corre el barrido ya la ve.
      await redis.set(panelRevokedAtKey(userId), nowSeconds(), "EX", PANEL_ACCESS_TOKEN_TTL_SECONDS);
      return revokeNamespace("panel-refresh", userId);
    },

    async revokeAccessTokensIssuedBefore(userId: string): Promise<void> {
      assertValidUserId(userId);
      await redis.set(`user-revoked-at:${userId}`, nowSeconds(), "EX", ACCESS_TOKEN_TTL_SECONDS);
    },
  };
}
