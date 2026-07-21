import { FastifyInstance } from "fastify";

export default async function paymentsRoutes(app: FastifyInstance) {
  app.get("/", async () => {
    return { module: "payments" };
  });
}
