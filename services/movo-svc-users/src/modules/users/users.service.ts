import { Pool } from "pg";
import { createUsersRepository } from "./users.repository";

export function createUsersService(db: Pool) {
  const repository = createUsersRepository(db);

  return {
    async getUsersCount(): Promise<number> {
      return repository.count();
    },
  };
}
