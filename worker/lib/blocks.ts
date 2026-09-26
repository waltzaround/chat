import { and, eq, inArray, or } from "drizzle-orm";
import { schema, type Db } from "../db";

/** Has either person blocked the other? */
export async function blockedEitherWay(db: Db, a: string, b: string): Promise<boolean> {
  const row = await db
    .select({ one: schema.userBlocks.blockerUserId })
    .from(schema.userBlocks)
    .where(
      or(
        and(eq(schema.userBlocks.blockerUserId, a), eq(schema.userBlocks.blockedUserId, b)),
        and(eq(schema.userBlocks.blockerUserId, b), eq(schema.userBlocks.blockedUserId, a)),
      ),
    )
    .limit(1);
  return row.length > 0;
}

/** Of `userIds`, who has blocked `authorId` (and so shouldn't be notified by them). */
export async function usersBlocking(db: Db, authorId: string, userIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < userIds.length; i += 90) {
    const rows = await db
      .select({ id: schema.userBlocks.blockerUserId })
      .from(schema.userBlocks)
      .where(and(eq(schema.userBlocks.blockedUserId, authorId), inArray(schema.userBlocks.blockerUserId, userIds.slice(i, i + 90))));
    for (const r of rows) out.add(r.id);
  }
  return out;
}
