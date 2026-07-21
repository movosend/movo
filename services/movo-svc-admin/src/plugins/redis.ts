import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import Redis from "ioredis";

export default fp(async (app: FastifyInstance) => {
  const redis = new Redis(process.env.REDIS_URL as string);

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
