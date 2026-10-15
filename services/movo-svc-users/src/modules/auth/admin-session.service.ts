import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { verify } from "@node-rs/argon2";
import Redis from "ioredis";
import { PrismaClient } from "../../generated/prisma/client";
import { AccountStatus, ApiError, PANEL_SESSION_TTL_SECONDS, UserRole } from "@movo/shared";
import { createUserRepository } from "../../repositories/user-repository";
import { SessionRepository } from "../../repositories/session-repository";
import { OtpService } from "../../services/otp-service";
import { User } from "../../models/user";
import {
  DUMMY_HASH,
  hashRefreshSecret,
  issuePanelSession,
  PanelSessionNotSavedError,
  parseRefreshToken,
  PanelSessionResult,
} from "./auth.service";

/** Flujo del OTP del login del panel: namespacea el índice del OTP (MOVO-133), así un
 * código de otro flujo nunca abre una sesión de panel. */
export const ADMIN_LOGIN_OTP_FLOW = "admin-login";

// AC9 de MOVO-287, la parte "por email". El gateway proxea el body sin parsearlo y
// aplica un solo limiter por request (por IP), así que este contador vive acá. Cuenta
// TODOS los intentos, exista o no la cuenta y salga bien o mal: si solo contara los
// fallidos, un 429 distinto según el email revelaría algo.
// La key es email + IP del cliente (review de PR #244): solo por email, cualquiera que
// conociera el email de un admin lo dejaba afuera con 5 intentos cada 15 min. Así un
// atacante solo se bloquea a sí mismo; probar desde muchas IPs sigue chocando con el
// Argon2id, el límite por IP del gateway y el segundo factor por email.
const ADMIN_LOGIN_RATE_LIMIT_MAX = 5;
const ADMIN_LOGIN_RATE_LIMIT_WINDOW_SECONDS = 15 * 60;

// INCR + EXPIRE en un solo paso (review de PR #244): con `SET NX` + `INCR` separados, si la
// key vencía entre los dos el `INCR` la recreaba sin TTL y el par quedaba en 429 para
// siempre. Se pone el TTL si la key no tiene uno, no solo cuando vale 1.
const CONSUME_LOGIN_ATTEMPT_SCRIPT = `
local attempts = redis.call("INCR", KEYS[1])
if redis.call("TTL", KEYS[1]) < 0 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return attempts
`;

const INVALID_CREDENTIALS = () => new ApiError(401, "AUTH_INVALID_CREDENTIALS", "Credenciales inválidas.");
const REFRESH_INVALID = () => new ApiError(401, "AUTH_REFRESH_INVALID", "Refresh token inválido.");

export interface AdminLoginResult {
  /** otpId del código enviado por email: el paso 2 lo devuelve junto con el código. */
  challengeId: string;
  cooldownSeconds: number;
}

/**
 * Única definición de "puede tener una sesión de panel" (MOVO-287): la usan el login, el
 * verify (el usuario pudo cambiar en los 10 min del OTP) y cada refresh (AC5).
 */
export function isPanelEligible(user: User): boolean {
  return user.roles.includes(UserRole.ADMIN) && user.emailVerified && user.status === AccountStatus.ACTIVE;
}

function adminLoginAttemptsKey(email: string, clientIp: string): string {
  // Hash en vez del email y la IP en claro: la key no necesita ser legible y así no queda
  // PII en Redis.
  return `admin-login-attempts:${createHash("sha256").update(`${email}|${clientIp}`).digest("hex")}`;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function createAdminSessionService(
  db: PrismaClient,
  redis: Redis,
  otpService: Pick<OtpService, "generateOtp" | "verifyOtp">,
  sessionRepository: SessionRepository
) {
  const repository = createUserRepository(db);

  async function consumeLoginAttempt(email: string, clientIp: string): Promise<void> {
    const attempts = (await redis.eval(
      CONSUME_LOGIN_ATTEMPT_SCRIPT,
      1,
      adminLoginAttemptsKey(email, clientIp),
      ADMIN_LOGIN_RATE_LIMIT_WINDOW_SECONDS
    )) as number;
    if (attempts > ADMIN_LOGIN_RATE_LIMIT_MAX) {
      throw new ApiError(429, "RATE_LIMIT_EXCEEDED", "Demasiados intentos. Esperá unos minutos antes de reintentar.");
    }
  }

  /** Una sesión que venció o se revocó mientras se emitía es un 401 del flujo, no un 500. */
  async function issuePanelSessionOr(
    onRejected: () => ApiError,
    user: User,
    absoluteExpiresAt: number
  ): Promise<PanelSessionResult> {
    try {
      return await issuePanelSession(sessionRepository, user, absoluteExpiresAt);
    } catch (error) {
      if (error instanceof PanelSessionNotSavedError) {
        throw onRejected();
      }
      throw error;
    }
  }

  // The refresh secret has server-generated entropy. Derive an encryption key with
  // domain separation; Redis never stores the response tokens in plaintext.
  function cacheKey(token: string): string {
    return `panel-rotation:${createHash("sha256").update(token).digest("hex")}`;
  }
  function encryptionKey(token: string): Buffer {
    return createHash("sha256").update(`movo-panel-rotation-v1:${token}`).digest();
  }
  function seal(token: string, value: PanelSessionResult): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", encryptionKey(token), iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
  }
  function unseal(token: string, value: string): PanelSessionResult {
    const bytes = Buffer.from(value, "base64");
    const cipher = createDecipheriv("aes-256-gcm", encryptionKey(token), bytes.subarray(0, 12));
    cipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString());
  }
  async function validateShared(value: PanelSessionResult): Promise<void> {
    const parsed = parseRefreshToken(value.refreshToken);
    const user = parsed ? await repository.findById(parsed.userId) : null;
    if (!parsed || !user || !isPanelEligible(user) || Date.parse(value.sessionExpiresAt) <= Date.now()) {
      throw REFRESH_INVALID();
    }
    // Logout, token consumption and role revocation all invalidate the child record.
    const raw = await redis.get(`panel-refresh:${parsed.userId}:${parsed.tokenId}`);
    const revokedAt = await redis.get(`panel-revoked-at:${parsed.userId}`);
    if (!raw || JSON.parse(raw).used || JSON.parse(raw).hash !== hashRefreshSecret(parsed.secret) ||
        (revokedAt && Number(revokedAt) >= Date.parse(value.sessionExpiresAt) / 1000 - PANEL_SESSION_TTL_SECONDS)) {
      throw REFRESH_INVALID();
    }
  }

  const service = {
    /**
     * Paso 1 (AC1): nunca emite tokens. Las cuatro causas de rechazo (credenciales,
     * rol, email sin verificar, cuenta no activa) responden el mismo 401 (AC3), y todas
     * pasan exactamente por un Argon2id antes de mirar rol y estado, así el tiempo de
     * respuesta no delata cuál fue. Mismo `DUMMY_HASH` que el login de la app (MOVO-74).
     */
    async startLogin(rawEmail: string, password: string, clientIp: string): Promise<AdminLoginResult> {
      const email = rawEmail.trim().toLowerCase();
      await consumeLoginAttempt(email, clientIp);

      // Un ":" en el email no puede ser target de un OTP (`otp-repository.ts`); se trata
      // como una cuenta inexistente.
      const user = email.includes(":") ? null : await repository.findByEmail(email);
      const passwordMatches = await verify(user?.passwordHash ?? DUMMY_HASH, password).catch(() => false);
      if (!user || !passwordMatches || !isPanelEligible(user)) {
        throw INVALID_CREDENTIALS();
      }

      // Al email de la cuenta, no al que escribió el usuario: `findByEmail` no distingue
      // mayúsculas y el canal es la dirección verificada.
      const { otpId, cooldownSeconds } = await otpService.generateOtp(
        ADMIN_LOGIN_OTP_FLOW,
        user.email,
        { userId: user.id },
        "email"
      );
      return { challengeId: otpId, cooldownSeconds };
    },

    /**
     * Paso 2 (AC2): expiración, límite de intentos y un solo uso los pone el OTP de
     * MOVO-139. La sesión arranca acá, así que el vencimiento absoluto de 8 h también.
     */
    async verify(challengeId: string, code: string): Promise<PanelSessionResult> {
      const { meta } = await otpService.verifyOtp(challengeId, code, ADMIN_LOGIN_OTP_FLOW);
      const user = meta.userId ? await repository.findById(meta.userId) : null;
      if (!user || !isPanelEligible(user)) {
        throw INVALID_CREDENTIALS();
      }
      return issuePanelSessionOr(INVALID_CREDENTIALS, user, nowSeconds() + PANEL_SESSION_TTL_SECONDS);
    },

    /**
     * AC4/AC5: rota el refresh conservando el vencimiento absoluto y revalida rol y
     * estado contra la base. Cualquier rechazo es 401 (a diferencia del 403 de la app
     * por cuenta suspendida): el panel solo necesita saber que la sesión terminó.
     */
    async rotate(refreshToken: string): Promise<PanelSessionResult> {
      const parsed = parseRefreshToken(refreshToken);
      if (!parsed) {
        throw REFRESH_INVALID();
      }
      const { userId, tokenId, secret } = parsed;

      const result = await sessionRepository.consumePanelRefreshToken(userId, tokenId, hashRefreshSecret(secret));
      if (result.status === "already-used") {
        // Reuso de un refresh ya rotado: señal de robo (mismo criterio que la app,
        // MOVO-75), pero se cortan solo las sesiones de panel.
        await sessionRepository.revokePanelSessionsForUser(userId);
        throw REFRESH_INVALID();
      }
      if (result.status !== "ok" || result.absoluteExpiresAt <= nowSeconds()) {
        throw REFRESH_INVALID();
      }

      const user = await repository.findById(userId);
      if (!user || !isPanelEligible(user)) {
        await sessionRepository.revokePanelSessionsForUser(userId);
        throw REFRESH_INVALID();
      }

      return issuePanelSessionOr(REFRESH_INVALID, user, result.absoluteExpiresAt);
    },

    async refresh(refreshToken: string, idempotencyKey?: string): Promise<PanelSessionResult> {
      if (!idempotencyKey) return service.rotate(refreshToken);
      if (!parseRefreshToken(refreshToken)) throw REFRESH_INVALID();
      const key = cacheKey(refreshToken);
      const owner = createHash("sha256").update(idempotencyKey).digest("hex");
      const pending = JSON.stringify({ owner, nonce: randomBytes(16).toString("hex") });
      const acquired = await redis.set(key, pending, "EX", 10, "NX");
      if (acquired) {
        // A failed rotation leaves a pending marker: never consume again in this window.
        const result = await service.rotate(refreshToken);
        await validateShared(result);
        // Compare-and-set: a logout or an expired lease must never be overwritten.
        const published = await redis.eval(`
          if redis.call("GET", KEYS[1]) ~= ARGV[1] then return 0 end
          redis.call("SET", KEYS[1], ARGV[2], "EX", 10)
          return 1
        `, 1, key, pending, JSON.stringify({ owner, value: seal(refreshToken, result) }));
        if (published !== 1) {
          const child = parseRefreshToken(result.refreshToken)!;
          await sessionRepository.revokePanelRefreshToken(child.userId, child.tokenId);
          throw REFRESH_INVALID();
        }
        await validateShared(result);
        return result;
      }
      for (let attempt = 0; attempt < 100; attempt++) {
        const raw = await redis.get(key);
        if (!raw) throw REFRESH_INVALID();
        const cached = JSON.parse(raw) as { owner: string; value?: string; blocked?: boolean };
        if (cached.blocked) throw REFRESH_INVALID();
        if (cached.owner !== owner) return service.rotate(refreshToken);
        if (cached.value) {
          const result = unseal(refreshToken, cached.value);
          await validateShared(result);
          return result;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new ApiError(503, "INTERNAL_ERROR", "La renovación está en curso. Reintentá.");
    },

    /** AC8: idempotente, mismo criterio que el logout de la app (token ajeno o inválido
     * es un no-op silencioso). */
    async logout(refreshToken: string, requestUserId: string): Promise<void> {
      const parsed = parseRefreshToken(refreshToken);
      if (!parsed || parsed.userId !== requestUserId) {
        return;
      }
      // Logout racing a rotation also revokes its child, including pending rotations.
      const key = cacheKey(refreshToken);
      const raw = await redis.eval(`
        local previous = redis.call("GET", KEYS[1])
        redis.call("SET", KEYS[1], '{"blocked":true}', "EX", 10)
        return previous
      `, 1, key) as string | null;
      await sessionRepository.revokePanelRefreshToken(parsed.userId, parsed.tokenId);
      if (raw) {
        const cached = JSON.parse(raw) as { value?: string; blocked?: boolean };
        if (cached.blocked) return;
        if (cached.value) {
          const child = parseRefreshToken(unseal(refreshToken, cached.value).refreshToken);
          if (child) await sessionRepository.revokePanelRefreshToken(child.userId, child.tokenId);
        }
      }
    },

    /**
     * AC7: corte inmediato de todas las sesiones de panel del usuario, sin tocar las de
     * la app. Lo van a usar la baja del rol (MOVO-290) y la suspensión (MOVO-296).
     */
    async revokePanelSessions(userId: string): Promise<void> {
      await sessionRepository.revokePanelSessionsForUser(userId);
    },
  };
  return service;
}

export type AdminSessionService = ReturnType<typeof createAdminSessionService>;
