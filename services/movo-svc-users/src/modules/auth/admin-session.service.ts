import { createHash } from "node:crypto";
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

  return {
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
    async refresh(refreshToken: string): Promise<PanelSessionResult> {
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

    /** AC8: idempotente, mismo criterio que el logout de la app (token ajeno o inválido
     * es un no-op silencioso). */
    async logout(refreshToken: string, requestUserId: string): Promise<void> {
      const parsed = parseRefreshToken(refreshToken);
      if (!parsed || parsed.userId !== requestUserId) {
        return;
      }
      await sessionRepository.revokePanelRefreshToken(parsed.userId, parsed.tokenId);
    },

    /**
     * AC7: corte inmediato de todas las sesiones de panel del usuario, sin tocar las de
     * la app. Lo van a usar la baja del rol (MOVO-290) y la suspensión (MOVO-296).
     */
    async revokePanelSessions(userId: string): Promise<void> {
      await sessionRepository.revokePanelSessionsForUser(userId);
    },
  };
}

export type AdminSessionService = ReturnType<typeof createAdminSessionService>;
