import { FastifyInstance } from "fastify";
import { createUsersService } from "./users.service";
import { usersSchemas } from "./users.schema";

export default async function usersRoutes(app: FastifyInstance) {
  const service = createUsersService(app.db);

  app.get(
    "/count",
    { schema: { response: { 200: usersSchemas.usersCountResponse } } },
    async () => {
      const count = await service.getUsersCount();
      return { count };
    },
  );
}
