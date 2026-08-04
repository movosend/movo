import { PrismaClient } from "../../generated/prisma/client";
import { createUserRepository } from "../../repositories/user-repository";

export function createUsersService(db: PrismaClient) {
  const repository = createUserRepository(db);

  return {
    async getUsersCount(): Promise<number> {
      return repository.count();
    },
  };
}
