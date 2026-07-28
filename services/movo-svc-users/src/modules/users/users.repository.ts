import { Pool } from "pg";

export function createUsersRepository(db: Pool) {
  return {
    async count(): Promise<number> {
      const result = await db.query<{ count: string }>("SELECT COUNT(*)::int AS count FROM users");
      return Number(result.rows[0]?.count ?? 0);
    },
  };
}
