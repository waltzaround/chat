import { Hono } from "hono";
import { and, eq, sql } from "drizzle-orm";
import type { AppEnv } from "../auth/middleware";
import { requireUser } from "../auth/middleware";
import { schema } from "../db";
import { ApiError } from "../lib/errors";
import { parseBody } from "../lib/validate";
import { toCurrentUser, toWorkspaceSummary } from "../lib/serialize";
import { registrationPolicy, serverOwnerId } from "../instance";
import { emailEnabled } from "../email";
import { updateMeSchema } from "@shared/schemas";
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

meRoutes.get("/me", async (c) => c.json(toCurrentUser(c.get("user"), await serverOwnerId(c.env.DB))));

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
  return c.json(toCurrentUser(updated!, await serverOwnerId(c.env.DB)));
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
  const body: WorkspaceSummary[] = rows.map((r) => toWorkspaceSummary(r.workspace, Number(r.memberCount)));
  return c.json(body);
});
