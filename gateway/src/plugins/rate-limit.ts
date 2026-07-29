import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import redisPlugin from "./redis";
import { EnvConfig } from "../config/env";

export default fp(
  async (app: FastifyInstance, opts: { env: EnvConfig }) => {
    await app.register(redisPlugin, { env: opts.env });

    // global: false a propósito: el límite se aplica explícitamente por ruta
    // desde routes/index.ts (general para la mayoría de los endpoints,
    // estricto para login). @fastify/rate-limit solo corre un chequeo por
    // request (usa un flag interno para no duplicarse) — si dejáramos esto
    // en modo global además de aplicar el override manual, el chequeo
    // estricto de login nunca llegaría a ejecutarse.
    await app.register(rateLimit, {
      global: false,
      max: opts.env.RATE_LIMIT_MAX,
      timeWindow: "1 minute",
      redis: app.redis,
      skipOnError: false,
    });
  }
);
