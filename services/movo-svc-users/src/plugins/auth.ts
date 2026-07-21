import fp from "fastify-plugin";
import { FastifyInstance } from "fastify";
import jwt from "@fastify/jwt";

export default fp(async (app: FastifyInstance) => {
  app.register(jwt, {
    secret: process.env.JWT_SECRET as string,
  });

  app.decorate("authenticate", async (request: any, reply: any) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.code(401).send({ error: "unauthorized" });
    }
  });
});
