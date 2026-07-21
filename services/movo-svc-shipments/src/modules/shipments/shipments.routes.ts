import { FastifyInstance } from "fastify";

export default async function shipmentsRoutes(app: FastifyInstance) {
  app.get("/", async () => {
    return { module: "shipments" };
  });
}
