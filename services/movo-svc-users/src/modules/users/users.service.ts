import { Pool } from "pg";
import { createUserRepository } from "../../repositories/user-repository";

export function createUsersService(db: Pool) {
  const repository = createUserRepository(db);

  return {
    async getUsersCount(): Promise<number> {
      return repository.count();
    },
  };
}
