import { eq } from "drizzle-orm";
import { users, type User } from "./schema";
import type { Db } from "./source-runs";

export async function findUserById(
  db: Db,
  id: string,
): Promise<User | undefined> {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  return row;
}
