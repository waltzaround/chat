import { Hono } from "hono";
import { and, eq, sql } from "drizzle-orm";
import type { AppEnv } from "../auth/middleware";
import { requireUser, resolveSession } from "../auth/middleware";
import { schema } from "../db";
import { ApiError } from "../lib/errors";
import { notifyWorkspace } from "../lib/hub";
import { fileUrl, iso, toUserSummary } from "../lib/serialize";
import { checkRateLimit } from "../security/ratelimit";
import { clientIp } from "../security/turnstile";
import type { InvitePreview } from "@shared/types";

export const inviteRoutes = new Hono<AppEnv>();

async function loadValidInvite(db: AppEnv["Variables"]["db"], code: string) {
  const invite = await db.query.invites.findFirst({ where: eq(schema.invites.code, code) });
  if (!invite || invite.revokedAt) throw new ApiError(404, "not_found", "This invite is invalid or has been revoked");
  if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) throw new ApiError(410, "not_found", "This invite has expired");
  if (invite.maxUses !== null && invite.uses >= invite.maxUses) throw new ApiError(410, "not_found", "This invite has reached its maximum number of uses");
  return invite;
}

/** Public preview, used by the /invite/:code landing page (anonymous allowed). */
inviteRoutes.get("/:code", async (c) => {
  const db = c.get("db");
  checkRateLimit(`invite-preview:${clientIp(c.req.raw) ?? "anon"}`, 60, 60_000);
  const invite = await loadValidInvite(db, c.req.param("code"));
  const workspace = await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, invite.workspaceId) });
  if (!workspace) throw ApiError.notFound("Workspace");
  const [count] = await db.select({ count: sql<number>`count(*)` }).from(schema.workspaceMembers).where(and(eq(schema.workspaceMembers.workspaceId, workspace.id), eq(schema.workspaceMembers.status, "active")));
  const inviter = await db.query.users.findFirst({ where: eq(schema.users.id, invite.createdBy) });

  let isMember = false;
  const session = await resolveSession(c.get("auth"), db, c.req.raw.headers);
  if (session) {
    const m = await db.query.workspaceMembers.findFirst({ where: and(eq(schema.workspaceMembers.workspaceId, workspace.id), eq(schema.workspaceMembers.userId, session.user.id)) });
    isMember = !!m && m.status === "active";
  }
  const body: InvitePreview = {
    code: invite.code,
    workspace: { id: workspace.id, name: workspace.name, iconUrl: fileUrl(workspace.iconKey), memberCount: Number(count?.count ?? 0) },
    inviter: inviter ? toUserSummary(inviter) : null,
    expiresAt: iso(invite.expiresAt),
    isMember,
  };
  return c.json(body);
});

inviteRoutes.post("/:code/accept", requireUser, async (c) => {
  const db = c.get("db");
  const user = c.get("user");
  checkRateLimit(`invite-accept:${user.id}`, 10, 60_000);
  const invite = await loadValidInvite(db, c.req.param("code"));

  const banned = await db.query.bans.findFirst({ where: and(eq(schema.bans.workspaceId, invite.workspaceId), eq(schema.bans.userId, user.id)) });
  if (banned) throw ApiError.forbidden("You are banned from this workspace");

  const existing = await db.query.workspaceMembers.findFirst({ where: and(eq(schema.workspaceMembers.workspaceId, invite.workspaceId), eq(schema.workspaceMembers.userId, user.id)) });
  if (existing?.status === "active") return c.json({ workspaceId: invite.workspaceId, alreadyMember: true });

  await db.batch([
    db
      .insert(schema.workspaceMembers)
      .values({ workspaceId: invite.workspaceId, userId: user.id, joinedAt: new Date(), status: "active" })
      .onConflictDoUpdate({ target: [schema.workspaceMembers.workspaceId, schema.workspaceMembers.userId], set: { status: "active", joinedAt: new Date() } }),
    db.update(schema.invites).set({ uses: sql`${schema.invites.uses} + 1` }).where(eq(schema.invites.code, invite.code)),
  ]);
  await notifyWorkspace(c.env, invite.workspaceId, { type: "workspace.updated", reason: "members" });
  return c.json({ workspaceId: invite.workspaceId, alreadyMember: false });
});
