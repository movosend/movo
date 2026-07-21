import { FastifyInstance } from "fastify";

export default async function adminRoutes(app: FastifyInstance) {
  app.get("/", async () => {
    return { module: "admin" };
  });
}
