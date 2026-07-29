import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import Redis from "ioredis";

export interface RedisPluginOptions {
  redisUrl?: string;
}

export interface RedisHealthResult {
  status: "ok" | "error";
  error?: string;
}

export default fp<RedisPluginOptions>(async (app: FastifyInstance, opts: RedisPluginOptions) => {
  const redisUrl =
    opts.redisUrl ||
    (app as unknown as { config?: { REDIS_URL?: string } }).config?.REDIS_URL ||
    process.env.REDIS_URL ||
    "redis://localhost:6379";

  const redis = new Redis(redisUrl, {
    retryStrategy(times) {
      const delay = Math.min(times * 100, 3000);
      return delay;
    },
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
  });

  redis.on("error", (err) => {
    app.log.warn({ err: err.message }, "Redis client connection error");
  });

  const checkRedisHealth = async (): Promise<RedisHealthResult> => {
    try {
      if (redis.status !== "ready") {
        return { status: "error", error: `Redis status is '${redis.status}'` };
      }

      const pingResult = await Promise.race([
        redis.ping(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Redis health check timeout")), 2000)
        ),
      ]);

      if (pingResult === "PONG") {
        return { status: "ok" };
      }
      return { status: "error", error: `Unexpected PING response: ${pingResult}` };
    } catch (error) {
      return {
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };

  app.decorate("redis", redis);
  app.decorate("checkRedisHealth", checkRedisHealth);

  app.addHook("onClose", async () => {
    try {
      if (redis.status === "ready" || redis.status === "connecting") {
        await redis.quit();
      } else {
        redis.disconnect();
      }
    } catch {
      redis.disconnect();
    }
  });
});

declare module "fastify" {
  interface FastifyInstance {
    redis: Redis;
    checkRedisHealth: () => Promise<RedisHealthResult>;
  }
}
