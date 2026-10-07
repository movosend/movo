import fp from "fastify-plugin";
import { createHash, timingSafeEqual } from "node:crypto";
import { FastifyInstance, FastifyRequest } from "fastify";
import { ApiError } from "@movo/shared";
import { EnvConfig } from "../config/env";

declare module "fastify" {
  interface FastifyInstance {
    /**
     * Autentica un cliente "demo" (juegos de `movo-institucional`) por el header
     * `x-api-key` y devuelve su id (`demo-1`, `demo-2`, ...: la posición de la key en
     * `DEMO_API_KEYS`, así los logs y el rate limit distinguen clientes sin exponer la
     * key). Lanza 401 `AUTH_API_KEY_INVALID` si falta o no coincide.
     */
    authenticateApiKey: (request: FastifyRequest) => Promise<string>;
  }
}

const sha256 = (value: string) => createHash("sha256").update(value).digest();

/**
 * Sin JWT a propósito: el cliente es el servidor de Next.js del sitio institucional, no
 * un usuario. La key vive solo en ese servidor (nunca en el navegador), así que no hace
 * falta CORS. Se comparan hashes SHA-256 de largo fijo con `timingSafeEqual` (comparar
 * strings directo filtra por tiempo cuántos caracteres coinciden) y se recorren todas las
 * keys sin cortar al encontrar la buena.
 */
export default fp(async (app: FastifyInstance, opts: { env: EnvConfig }) => {
  const keyHashes = opts.env.DEMO_API_KEYS.map(sha256);

  app.decorate("authenticateApiKey", async (request: FastifyRequest) => {
    const provided = request.headers["x-api-key"];
    if (typeof provided !== "string" || provided.length === 0 || keyHashes.length === 0) {
      throw new ApiError(401, "AUTH_API_KEY_INVALID", "Missing or invalid API key");
    }

    const providedHash = sha256(provided);
    let matchIndex = -1;
    keyHashes.forEach((hash, index) => {
      if (timingSafeEqual(hash, providedHash) && matchIndex === -1) {
        matchIndex = index;
      }
    });

    if (matchIndex === -1) {
      throw new ApiError(401, "AUTH_API_KEY_INVALID", "Missing or invalid API key");
    }
    return `demo-${matchIndex + 1}`;
  });
});
