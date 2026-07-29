import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import Redis from "ioredis";
import { EnvConfig } from "../config/env";

export default fp(async (app: FastifyInstance, opts: { env: EnvConfig }) => {
  const redis = new Redis(opts.env.REDIS_URL);

  app.decorate("redis", redis);

  app.addHook("onClose", async () => {
    redis.disconnect();
  });
});

declare module "fastify" {
  interface FastifyInstance {
    redis: Redis;
  }
}
