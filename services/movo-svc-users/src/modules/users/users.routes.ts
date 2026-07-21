import { FastifyInstance } from "fastify";

export default async function usersRoutes(app: FastifyInstance) {
  app.get("/", async () => {
    return { module: "users" };
  });
}
