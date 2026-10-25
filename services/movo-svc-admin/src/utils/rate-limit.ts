import type Redis from "ioredis";
import { ApiError } from "@movo/shared";

/**
 * INCR + EXPIRE en un solo paso (mismo script que el login del panel de `svc-users`): con `INCR` y
 * `EXPIRE` separados, si la key vencía entre los dos quedaba sin TTL y el límite no se levantaba nunca.
 */
const COUNT_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if redis.call("TTL", KEYS[1]) < 0 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return count
`;

/** Ventana fija: cuenta el intento y lanza 429 si pasó el máximo. Cuenta también los intentos rechazados. */
export async function consumeRateLimit(
  redis: Redis,
  key: string,
  max: number,
  windowSeconds: number,
): Promise<void> {
  const count = (await redis.eval(COUNT_SCRIPT, 1, key, windowSeconds)) as number;
  if (count > max) {
    throw new ApiError(429, "RATE_LIMIT_EXCEEDED", "Demasiados intentos. Esperá un momento antes de reintentar.");
  }
}
