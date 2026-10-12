/**
 * Accounts for bots and webhooks. They are ordinary `users` rows so their messages have
 * a real author, marked with a kind and given an address that can never receive mail.
 * They have no password or sign-in provider, so nobody can sign in as one.
 */
import { and, eq, inArray, like } from "drizzle-orm";
import { newId } from "@shared/id";
import { schema, type Db } from "../db";

export type AppKind = "bot" | "webhook";
type UserRow = typeof schema.users.$inferSelect;

export const APP_NAME_MAX = 48;

/** A username from a display name: "Deploy Bot" becomes "deploy_bot", made unique. */
export async function uniqueUsername(db: Db, name: string, fallback: string): Promise<string> {
  let base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s.-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_.]/g, "")
    .replace(/^[._]+|[._]+$/g, "")
    .slice(0, 26);
  if (base.length < 2) base = fallback;
  const taken = new Set((await db.select({ username: schema.users.username }).from(schema.users).where(like(schema.users.username, `${base}%`))).map((u) => u.username));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}_${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}_${newId().slice(-5).toLowerCase()}`;
}

export async function createAppUser(db: Db, input: { kind: AppKind; name: string; image?: string | null }): Promise<UserRow> {
  const id = newId();
  const now = new Date();
  const username = await uniqueUsername(db, input.name, input.kind);
  const [row] = await db
    .insert(schema.users)
    .values({
      id,
      username,
      displayName: input.name.trim().slice(0, APP_NAME_MAX),
      // The .invalid domain is reserved and can never receive mail.
      email: `${id.toLowerCase()}@${input.kind}s.invalid`,
      emailVerified: false,
      image: input.image ?? null,
      kind: input.kind,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return row!;
}

/** Retires an app account: it leaves every workspace, and its old messages keep its name. */
export async function retireAppUser(db: Db, userId: string): Promise<string[]> {
  const memberships = await db.select({ workspaceId: schema.workspaceMembers.workspaceId }).from(schema.workspaceMembers).where(eq(schema.workspaceMembers.userId, userId));
  await db.delete(schema.memberRoles).where(eq(schema.memberRoles.userId, userId));
  await db.delete(schema.workspaceMembers).where(eq(schema.workspaceMembers.userId, userId));
  await db.update(schema.users).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(schema.users.id, userId));
  return memberships.map((m) => m.workspaceId);
}

export function isAppUser(user: Pick<UserRow, "kind">): boolean {
  return user.kind === "bot" || user.kind === "webhook";
}

/** Of these user ids, the ones that are people rather than apps. */
export async function humanIds(db: Db, userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await db.select({ id: schema.users.id }).from(schema.users).where(and(inArray(schema.users.id, userIds), eq(schema.users.kind, "human")));
  return new Set(rows.map((r) => r.id));
}
