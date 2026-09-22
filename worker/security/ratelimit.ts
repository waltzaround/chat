import { sql } from "drizzle-orm";
import type { Db } from "../db";
import { schema } from "../db";
import { ApiError } from "../lib/errors";

/**
 * Fixed-window rate limiter kept in isolate memory. Suitable for per-user
 * burst protection on API routes; the WorkspaceHub applies its own limits to
 * socket events, and auth attempts use the D1-backed limiter below so they
 * are enforced across isolates.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();
let lastSweep = 0;

export function checkRateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  if (now - lastSweep > 60_000) {
    for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    lastSweep = now;
  }
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    throw ApiError.rateLimited(Math.ceil((bucket.resetAt - now) / 1000));
  }
}

/** Increments a D1-backed counter and returns the count within the window. */
export async function bumpPersistentCounter(db: Db, key: string, windowMs: number): Promise<number> {
  const now = Date.now();
  const resetAt = now + windowMs;
  const rows = await db
    .insert(schema.rateLimits)
    .values({ key, count: 1, resetAt })
    .onConflictDoUpdate({
      target: schema.rateLimits.key,
      set: {
        count: sql`CASE WHEN ${schema.rateLimits.resetAt} <= ${now} THEN 1 ELSE ${schema.rateLimits.count} + 1 END`,
        resetAt: sql`CASE WHEN ${schema.rateLimits.resetAt} <= ${now} THEN ${resetAt} ELSE ${schema.rateLimits.resetAt} END`,
      },
    })
    .returning({ count: schema.rateLimits.count });
  return rows[0]?.count ?? 1;
}

export async function resetPersistentCounter(db: Db, key: string): Promise<void> {
  await db.delete(schema.rateLimits).where(sql`${schema.rateLimits.key} = ${key}`);
}
