import { createHash, randomBytes } from "node:crypto";
import type Redis from "ioredis";
import {
  ApiError,
  StepUpChallenge,
  StepUpToken,
  STEP_UP_CODE_TTL_SECONDS,
  STEP_UP_TOKEN_TTL_SECONDS,
} from "@movo/shared";
import type { OtpService } from "../../services/otp-service";
import type { UserRepository } from "../../repositories/user-repository";
import { isPanelEligible } from "../auth/admin-session.service";

/**
 * MOVO-332 (ADR-055): segundo factor por acción para el cambio de estado de un envío desde el panel.
 * Distinto del OTP de la jornada (MOVO-287): ese abre la sesión de 8 h, este se pide para UNA acción
 * (admin + envío + destino) y se consume al usarla.
 *
 * El código sale por email (motor de OTP de MOVO-139) con un `flow` propio de la acción: un código
 * pedido para un envío o destino no verifica para otro por construcción (`verifyOtp` exige el flujo).
 * Al verificarlo se canjea por un `stepUpToken` de un solo uso, que `svc-admin` consume antes de llamar
 * a `svc-shipments`.
 */
export const STEP_UP_REQUEST_LIMIT = 5;
export const STEP_UP_FAILURE_LIMIT = 5;
export const STEP_UP_WINDOW_SECONDS = 15 * 60;

const INVALID = () => new ApiError(401, "STEP_UP_INVALID", "El código ingresado es inválido o venció.");
const RATE_LIMITED = () =>
  new ApiError(429, "RATE_LIMIT_EXCEEDED", "Demasiados intentos. Esperá unos minutos antes de reintentar.");

/** INCR + EXPIRE en un paso (mismo script que el login del panel): sin esto, una key sin TTL bloquearía para siempre. */
const COUNT_SCRIPT = `
local attempts = redis.call("INCR", KEYS[1])
if redis.call("TTL", KEYS[1]) < 0 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return attempts
`;

const requestsKey = (adminId: string) => `admin-step-up-requests:${adminId}`;
const failuresKey = (adminId: string) => `admin-step-up-failures:${adminId}`;
const tokenKey = (token: string) => `admin-step-up-token:${createHash("sha256").update(token).digest("hex")}`;

/** El flujo del OTP lleva la acción: sin ":" porque `otp-repository` lo usa para armar sus keys. */
export const stepUpFlow = (shipmentId: string, targetStatus: string) => `admin-step-up-${shipmentId}-${targetStatus}`;

export interface StepUpAction {
  adminId: string;
  shipmentId: string;
  targetStatus: string;
}

export interface AdminStepUpService {
  request(action: StepUpAction): Promise<StepUpChallenge>;
  verify(action: StepUpAction & { challengeId: string; code: string }): Promise<StepUpToken>;
  /** Canjea el token: un solo uso, y solo para la acción para la que se emitió. */
  consume(action: StepUpAction & { stepUpToken: string }): Promise<void>;
}

export function createAdminStepUpService(deps: {
  redis: Redis;
  otpService: Pick<OtpService, "generateOtp" | "verifyOtp">;
  userRepository: Pick<UserRepository, "findById">;
}): AdminStepUpService {
  const { redis, otpService, userRepository } = deps;

  async function count(key: string): Promise<number> {
    return (await redis.eval(COUNT_SCRIPT, 1, key, STEP_UP_WINDOW_SECONDS)) as number;
  }

  return {
    async request({ adminId, shipmentId, targetStatus }) {
      const user = await userRepository.findById(adminId);
      // La sesión de panel ya pasó por el gateway, pero la cuenta pudo perder el rol o el email verificado.
      if (!user || !isPanelEligible(user)) {
        throw new ApiError(403, "AUTH_FORBIDDEN", "Esta cuenta no puede hacer esta operación.");
      }
      if ((await count(requestsKey(adminId))) > STEP_UP_REQUEST_LIMIT) throw RATE_LIMITED();

      // Al email verificado de la cuenta, mismo canal que el login del panel.
      const { otpId, cooldownSeconds } = await otpService.generateOtp(
        stepUpFlow(shipmentId, targetStatus),
        user.email,
        { adminId, issuedAt: String(Date.now()) },
        "email",
      );
      const [name, domain] = user.email.split("@");
      return {
        challengeId: otpId,
        maskedEmail: `${name?.[0] ?? ""}***@${domain}`,
        cooldownSeconds,
        expiresInSeconds: STEP_UP_CODE_TTL_SECONDS,
      };
    },

    async verify({ adminId, shipmentId, targetStatus, challengeId, code }) {
      // Bloqueo temporal ante varios errores, antes de tocar el código: un bloqueado no sigue adivinando.
      const failures = Number((await redis.get(failuresKey(adminId))) ?? 0);
      if (failures >= STEP_UP_FAILURE_LIMIT) throw RATE_LIMITED();

      const fail = async (): Promise<never> => {
        await count(failuresKey(adminId));
        throw INVALID();
      };

      let meta: Record<string, string>;
      try {
        ({ meta } = await otpService.verifyOtp(challengeId, code, stepUpFlow(shipmentId, targetStatus)));
      } catch (error) {
        // Código erróneo, vencido, ya usado o de otra acción: la misma respuesta para todos (sin enumeración).
        if (error instanceof ApiError && (error.code === "AUTH_OTP_INVALID" || error.code === "AUTH_OTP_EXPIRED")) {
          return fail();
        }
        throw error;
      }
      // El código se pidió para esta acción pero tiene que ser de este admin, y dentro de su vigencia.
      const issuedAt = Number(meta.issuedAt);
      if (meta.adminId !== adminId || !Number.isFinite(issuedAt) || Date.now() - issuedAt > STEP_UP_CODE_TTL_SECONDS * 1000) {
        return fail();
      }

      const user = await userRepository.findById(adminId);
      if (!user || !isPanelEligible(user)) return fail();

      const stepUpToken = randomBytes(32).toString("base64url");
      await redis.set(
        tokenKey(stepUpToken),
        JSON.stringify({ adminId, shipmentId, targetStatus }),
        "EX",
        STEP_UP_TOKEN_TTL_SECONDS,
      );
      await redis.del(failuresKey(adminId));
      return { stepUpToken, expiresInSeconds: STEP_UP_TOKEN_TTL_SECONDS };
    },

    async consume({ adminId, shipmentId, targetStatus, stepUpToken }) {
      // GETDEL: leer y borrar en un solo paso. Un token de otra acción también se quema: quien lo probó
      // en el lugar equivocado tiene que pedir otro código.
      const raw = await redis.getdel(tokenKey(stepUpToken));
      if (!raw) throw INVALID();
      let stored: Partial<StepUpAction>;
      try {
        stored = JSON.parse(raw) as Partial<StepUpAction>;
      } catch {
        throw INVALID();
      }
      if (stored.adminId !== adminId || stored.shipmentId !== shipmentId || stored.targetStatus !== targetStatus) {
        throw INVALID();
      }
    },
  };
}
