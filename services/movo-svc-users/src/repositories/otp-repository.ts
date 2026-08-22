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
  /**
   * MOVO-133 (review de tmvergara sobre PR #91): flujo para el que se emitió el OTP
   * (ej. "register", "phone-change", "email-change") -- namespacea el índice
   * `otp:target:*` por flujo además de por target, y `otp-service.ts#verifyOtp` lo
   * valida contra el flujo esperado antes de tocar el código. Sin esto, dos flujos
   * distintos sobre el mismo target se pisaban entre sí (ver `meta`/CLAUDE.md).
   */
  flow: string;
  /**
   * Metadata arbitraria atada al mismo hash que el OTP -- comparte su TTL, rotación
   * (`rotateCode`) e invalidación (`invalidate`) por construcción, así que no puede
   * desincronizarse de la vida del OTP como sí le pasaba a
   * `pending-email-repository.ts` (borrada en MOVO-133, este mismo fix). Ejemplos de
   * uso: `userId` (a quién pertenece el flujo, para que `verifyOtp` pueda atarlo) y
   * `pendingEmail` (el email candidato del flujo `email-change`).
   */
  meta: Record<string, string>;
}

export interface OtpRepository {
  /** Invalida cualquier OTP previamente activo para `(flow, target)` y crea uno nuevo. TTL fresco en ambas keys. */
  create(flow: string, target: string, codeHash: string, meta?: Record<string, string>): Promise<{ otpId: string }>;
  findById(otpId: string): Promise<OtpRecord | null>;
  findActiveIdByTarget(flow: string, target: string): Promise<string | null>;
  /** Código nuevo bajo el mismo otpId: resetea attempts a 0 y refresca el TTL. No-op si otpId no existe. */
  rotateCode(otpId: string, newCodeHash: string): Promise<void>;
  /** Incremento atómico. `null` si la key ya no existía (no crea una key fantasma sin TTL). */
  incrementAttempts(otpId: string): Promise<number | null>;
  /** Borra `otp:{otpId}` y su índice `otp:target:{flow}:{target}` juntos. Idempotente. */
  invalidate(otpId: string): Promise<void>;
  /**
   * Reemplaza la metadata de un OTP existente sin tocar código/attempts/TTL --
   * usada por `otp-service.ts#generateOtp` en la rama de reuso (dentro del cooldown)
   * para que un segundo pedido con datos distintos (ej. otro email candidato) no
   * quede pisado por el primero. No-op si `otpId` no existe.
   */
  setMeta(otpId: string, meta: Record<string, string>): Promise<void>;
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

/** `otpId`/`flow` son input interpolado en la key -- sin este guard, un valor con ":"
 * armado a mano podría colisionar con el formato de `otp:target:*` (STRING, no HASH)
 * y disparar un WRONGTYPE de Redis sin manejar. Se trata como "no encontrado", no se lanza. */
function isValidId(id: string): boolean {
  return id.length > 0 && !id.includes(":");
}

function parseMeta(raw: string | undefined): Record<string, string> {
  if (!raw) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string")
      );
    }
  } catch {
    // JSON corrupto (no debería pasar, solo esta capa escribe esta key) -- se trata
    // como "sin metadata" en vez de tirar, igual que el resto de los campos opcionales.
  }
  return {};
}

export function createOtpRepository(redis: Redis): OtpRepository {
  const otpKey = (otpId: string): string => `otp:${otpId}`;
  const targetKey = (flow: string, target: string): string => `otp:target:${flow}:${target}`;

  return {
    async create(flow: string, target: string, codeHash: string, meta: Record<string, string> = {}): Promise<{ otpId: string }> {
      if (!isValidId(flow)) {
        throw new Error("flow is required and cannot contain colons");
      }
      if (!target || target.includes(":")) {
        throw new Error("target cannot contain colons");
      }

      // Invariante: como máximo un OTP activo por (flow, target) — se invalida
      // cualquier OTP previo de ESTE flujo antes de generar uno nuevo. Namespaceado
      // por flujo (MOVO-133): antes esto era solo por target, así que una ruta
      // pública genérica sobre el mismo target (ej. /auth/send-otp) podía invalidar
      // en silencio el OTP de un flujo de cuenta ajeno (ver CLAUDE.md).
      const previousOtpId = await redis.get(targetKey(flow, target));
      if (previousOtpId) {
        await redis.unlink(otpKey(previousOtpId), targetKey(flow, target));
      }

      const otpId = randomUUID();
      const now = Date.now();

      await redis.hset(otpKey(otpId), {
        target,
        codeHash,
        attempts: 0,
        lastSentAt: now,
        flow,
        meta: JSON.stringify(meta),
      });
      await redis.expire(otpKey(otpId), OTP_TTL_SECONDS);
      await redis.set(targetKey(flow, target), otpId, "EX", OTP_TTL_SECONDS);

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
      if (!data.target || !data.codeHash || data.attempts === undefined || data.lastSentAt === undefined || !data.flow) {
        return null;
      }
      return {
        otpId,
        target: data.target,
        codeHash: data.codeHash,
        attempts: Number(data.attempts),
        lastSentAt: Number(data.lastSentAt),
        flow: data.flow,
        meta: parseMeta(data.meta),
      };
    },

    async findActiveIdByTarget(flow: string, target: string): Promise<string | null> {
      if (!isValidId(flow) || !target || target.includes(":")) {
        return null;
      }
      return await redis.get(targetKey(flow, target));
    },

    async rotateCode(otpId: string, newCodeHash: string): Promise<void> {
      if (!isValidId(otpId)) {
        return;
      }
      const key = otpKey(otpId);
      const [target, flow] = await redis.hmget(key, "target", "flow");
      if (!target || !flow) {
        // Key inexistente (nunca existió, TTL vencido) — no-op, no recrear a medias.
        return;
      }
      await redis.hset(key, {
        codeHash: newCodeHash,
        attempts: 0,
        lastSentAt: Date.now(),
      });
      await redis.expire(key, OTP_TTL_SECONDS);
      await redis.expire(targetKey(flow, target), OTP_TTL_SECONDS);
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
      const [target, flow] = await redis.hmget(key, "target", "flow");
      const keysToDelete = target && flow ? [key, targetKey(flow, target)] : [key];
      await redis.unlink(...keysToDelete);
    },

    async setMeta(otpId: string, meta: Record<string, string>): Promise<void> {
      if (!isValidId(otpId)) {
        return;
      }
      const key = otpKey(otpId);
      const exists = await redis.exists(key);
      if (!exists) {
        return;
      }
      await redis.hset(key, { meta: JSON.stringify(meta) });
    },
  };
}
