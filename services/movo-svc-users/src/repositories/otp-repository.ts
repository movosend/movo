import Redis from "ioredis";
import { randomUUID } from "node:crypto";

export const OTP_TTL_SECONDS = 600; // 10 min (AC2)
export const OTP_MAX_ATTEMPTS = 5; // AC4

export interface OtpRecord {
  otpId: string;
  target: string;
  codeHash: string;
  attempts: number;
  lastSentAt: number;
}

export interface OtpRepository {
  /** Invalida cualquier OTP previamente activo para `target` y crea uno nuevo. TTL fresco en ambas keys. */
  create(target: string, codeHash: string): Promise<{ otpId: string }>;
  findById(otpId: string): Promise<OtpRecord | null>;
  findActiveIdByTarget(target: string): Promise<string | null>;
  /** Código nuevo bajo el mismo otpId: resetea attempts a 0 y refresca el TTL. No-op si otpId no existe. */
  rotateCode(otpId: string, newCodeHash: string): Promise<void>;
  /** Incremento atómico. `null` si la key ya no existía (no crea una key fantasma sin TTL). */
  incrementAttempts(otpId: string): Promise<number | null>;
  /** Borra `otp:{otpId}` y su índice `otp:target:{target}` juntos. Idempotente. */
  invalidate(otpId: string): Promise<void>;
}

// EXISTS + HINCRBY atómico: sin esto, si el TTL vence justo entre el `findById` del
// caller y el incremento, Redis crea implícitamente un hash nuevo de un solo campo, sin
// TTL, que queda vivo para siempre. -1 es el sentinel de "la key ya no existe".
const INCREMENT_ATTEMPTS_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) == 0 then
  return -1
end
return redis.call("HINCRBY", KEYS[1], "attempts", 1)
`;

/** `otpId` es input del cliente e se interpola en la key — sin este guard, un otpId con
 * ":" armado a mano podría colisionar con el formato de `otp:target:*` (STRING, no HASH)
 * y disparar un WRONGTYPE de Redis sin manejar. Se trata como "no encontrado", no se lanza. */
function isValidId(id: string): boolean {
  return id.length > 0 && !id.includes(":");
}

export function createOtpRepository(redis: Redis): OtpRepository {
  const otpKey = (otpId: string): string => `otp:${otpId}`;
  const targetKey = (target: string): string => `otp:target:${target}`;

  return {
    async create(target: string, codeHash: string): Promise<{ otpId: string }> {
      if (!target || target.includes(":")) {
        throw new Error("target cannot contain colons");
      }

      // Invariante: como máximo un OTP activo por target (ver plan, punto 2) — se
      // invalida cualquier OTP previo antes de generar uno nuevo.
      const previousOtpId = await redis.get(targetKey(target));
      if (previousOtpId) {
        await redis.unlink(otpKey(previousOtpId), targetKey(target));
      }

      const otpId = randomUUID();
      const now = Date.now();

      await redis.hset(otpKey(otpId), {
        target,
        codeHash,
        attempts: 0,
        lastSentAt: now,
      });
      await redis.expire(otpKey(otpId), OTP_TTL_SECONDS);
      await redis.set(targetKey(target), otpId, "EX", OTP_TTL_SECONDS);

      return { otpId };
    },

    async findById(otpId: string): Promise<OtpRecord | null> {
      if (!isValidId(otpId)) {
        return null;
      }
      const data = await redis.hgetall(otpKey(otpId));
      // `noUncheckedIndexedAccess` tipa el acceso a un Record<string,string> como
      // `string | undefined` — chequeo explícito en vez de asumir presencia, además de
      // cubrir el caso "key no existe" (hgetall devuelve {}).
      if (!data.target || !data.codeHash || data.attempts === undefined || data.lastSentAt === undefined) {
        return null;
      }
      return {
        otpId,
        target: data.target,
        codeHash: data.codeHash,
        attempts: Number(data.attempts),
        lastSentAt: Number(data.lastSentAt),
      };
    },

    async findActiveIdByTarget(target: string): Promise<string | null> {
      if (!target || target.includes(":")) {
        return null;
      }
      return await redis.get(targetKey(target));
    },

    async rotateCode(otpId: string, newCodeHash: string): Promise<void> {
      if (!isValidId(otpId)) {
        return;
      }
      const key = otpKey(otpId);
      const target = await redis.hget(key, "target");
      if (!target) {
        // Key inexistente (nunca existió, TTL vencido) — no-op, no recrear a medias.
        return;
      }
      await redis.hset(key, {
        codeHash: newCodeHash,
        attempts: 0,
        lastSentAt: Date.now(),
      });
      await redis.expire(key, OTP_TTL_SECONDS);
      await redis.expire(targetKey(target), OTP_TTL_SECONDS);
    },

    async incrementAttempts(otpId: string): Promise<number | null> {
      if (!isValidId(otpId)) {
        return null;
      }
      const result = await redis.eval(INCREMENT_ATTEMPTS_SCRIPT, 1, otpKey(otpId));
      const attempts = Number(result);
      return attempts === -1 ? null : attempts;
    },

    async invalidate(otpId: string): Promise<void> {
      if (!isValidId(otpId)) {
        return;
      }
      const key = otpKey(otpId);
      const target = await redis.hget(key, "target");
      const keysToDelete = target ? [key, targetKey(target)] : [key];
      await redis.unlink(...keysToDelete);
    },
  };
}
