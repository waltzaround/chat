import { Hono } from "hono";
import { and, eq, sql } from "drizzle-orm";
import type { AppEnv } from "../auth/middleware";
import { requireUser } from "../auth/middleware";
import { schema } from "../db";
import { ApiError } from "../lib/errors";
import { parseBody } from "../lib/validate";
import { toCurrentUser, toWorkspaceSummary } from "../lib/serialize";
import { canCreateWorkspace, registrationPolicy, serverOwnerId } from "../instance";
import { emailEnabled } from "../email";
import { deleteAccountSchema, updateMeSchema } from "@shared/schemas";
import { deleteAccount, exportAccount } from "../lib/accounts";
import { unreadMentionCounts } from "../lib/mentions";
import { checkRateLimit } from "../security/ratelimit";
import type { AuthConfig, WorkspaceSummary } from "@shared/types";

export const meRoutes = new Hono<AppEnv>();

/** Public: which auth providers are available, the Turnstile site key, and whether this is a fresh deployment. */
meRoutes.get("/auth-config", async (c) => {
  const [owner, registration] = await Promise.all([serverOwnerId(c.env.DB), registrationPolicy(c.env.DB)]);
  const body: AuthConfig = {
    providers: {
      github: !!(c.env.GITHUB_CLIENT_ID && c.env.GITHUB_CLIENT_SECRET),
      google: !!(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET),
    },
    turnstileSiteKey: c.env.TURNSTILE_SECRET_KEY ? c.env.TURNSTILE_SITE_KEY ?? null : null,
    firstRun: !owner,
    claimRequired: !owner && !!c.env.OWNER_CLAIM_TOKEN?.trim(),
    registration,
    passwordResetEmail: emailEnabled(c.env),
  };
  return c.json(body);
});

meRoutes.use("/me", requireUser);
meRoutes.use("/me/*", requireUser);

/** Server-wide facts about the signed-in account. */
async function serverContext(db: D1Database, userId: string) {
  const [ownerId, canCreate, password] = await Promise.all([serverOwnerId(db), canCreateWorkspace(db, userId), credentialAccount(db, userId)]);
  return { ownerId, canCreateWorkspace: canCreate, hasPassword: !!password };
}

function credentialAccount(db: D1Database, userId: string) {
  return db.prepare("SELECT password FROM accounts WHERE user_id = ? AND provider_id = 'credential' AND password IS NOT NULL").bind(userId).first<{ password: string }>();
}

/** Delete your own account. Asks for your username, and your password if you have one. */
meRoutes.delete("/me", async (c) => {
  const user = c.get("user");
  const input = await parseBody(c, deleteAccountSchema);
  if (input.confirmUsername.toLowerCase() !== user.username.toLowerCase()) throw ApiError.validation(undefined, "Type your username to confirm");
  const credential = await credentialAccount(c.env.DB, user.id);
  if (credential) {
    const ctx = await c.get("auth").$context;
    if (!input.password || !(await ctx.password.verify({ hash: credential.password, password: input.password }))) {
      throw ApiError.validation(undefined, "That password is wrong");
    }
  }
  await deleteAccount(c.env, c.get("db"), user.id, { deleteMessages: input.deleteMessages });
  return c.body(null, 204);
});

/** Download everything the server holds about you, as JSON. */
meRoutes.get("/me/export", (c) => {
  const user = c.get("user");
  checkRateLimit(`export:${user.id}`, 3, 60 * 60 * 1000);
  const date = new Date().toISOString().slice(0, 10);
  return new Response(exportAccount(c.get("db"), user.id), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="chat-export-${user.username}-${date}.json"`,
      "Cache-Control": "no-store",
    },
  });
});

meRoutes.get("/me", async (c) => c.json(toCurrentUser(c.get("user"), await serverContext(c.env.DB, c.get("user").id))));

meRoutes.patch("/me", async (c) => {
  const db = c.get("db");
  const user = c.get("user");
  const input = await parseBody(c, updateMeSchema);

  if (input.username && input.username !== user.username) {
    const taken = await db.query.users.findFirst({ where: eq(schema.users.username, input.username) });
    if (taken) throw ApiError.conflict("That username is taken");
  }
  if (input.avatarKey && !input.avatarKey.startsWith(`avatars/${user.id}/`)) {
    throw ApiError.forbidden("Avatar key does not belong to you");
  }

  const [updated] = await db
    .update(schema.users)
    .set({
      displayName: input.displayName ?? user.displayName,
      username: input.username ?? user.username,
      bio: input.bio === undefined ? user.bio : input.bio,
      status: input.status ?? user.status,
      avatarKey: input.avatarKey === undefined ? user.avatarKey : input.avatarKey,
      updatedAt: new Date(),
    })
    .where(eq(schema.users.id, user.id))
    .returning();
  return c.json(toCurrentUser(updated!, await serverContext(c.env.DB, updated!.id)));
});

meRoutes.get("/me/workspaces", async (c) => {
  const db = c.get("db");
  const user = c.get("user");
  const rows = await db
    .select({
      workspace: schema.workspaces,
      memberCount: sql<number>`(select count(*) from ${schema.workspaceMembers} wm where wm.workspace_id = ${schema.workspaces.id} and wm.status = 'active')`,
    })
    .from(schema.workspaceMembers)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.workspaceMembers.workspaceId))
    .where(and(eq(schema.workspaceMembers.userId, user.id), eq(schema.workspaceMembers.status, "active")))
    .orderBy(schema.workspaceMembers.joinedAt);
  const mentions = await unreadMentionCounts(c.get("db"), user.id, "workspace");
  const body: WorkspaceSummary[] = rows.map((r) => toWorkspaceSummary(r.workspace, Number(r.memberCount), mentions.get(r.workspace.id) ?? 0));
  return c.json(body);
});
