import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import type { BatchItem } from "drizzle-orm/batch";
import { schema } from "@db/schema";

export type Db = DrizzleD1Database<typeof schema>;

export function createDb(d1: D1Database): Db {
  return drizzle(d1, { schema });
}

/** Runs a heterogeneous list of statements as one D1 batch (atomic). */
export async function batchAll(db: Db, statements: unknown[]): Promise<void> {
  if (statements.length === 0) return;
  await db.batch(statements as unknown as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
}

export { schema };
