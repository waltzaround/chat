import { Hono } from "hono";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { AppEnv } from "../auth/middleware";
import { requireUser } from "../auth/middleware";
import { schema, batchAll } from "../db";
import { ApiError } from "../lib/errors";
import { parseBody, parseQuery } from "../lib/validate";
import { audit } from "../lib/audit";
import { notifyWorkspace } from "../lib/hub";
import { canCreateWorkspace } from "../instance";
import { hydrateMessages } from "../lib/messages";
import { unreadMentionCounts } from "../lib/mentions";
import { filterTerms } from "@shared/moderation";
import { fileUrl, iso, isoRequired, toUserSummary, toWorkspaceSummary } from "../lib/serialize";
import { track } from "../analytics/track";
import { checkRateLimit } from "../security/ratelimit";
import {
  Permission,
  canManageRole,
  canModerate,
  hasPermission,
  loadMemberContext,
  requireMember,
  requireAnyPermission,
  requirePermission,
  resolveAllChannelPermissions,
  visibleChannelIds,
  type MemberContext,
} from "../permissions/resolve";
import { newId, newInviteCode, slugify } from "@shared/id";
import { ALL_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS } from "@shared/permissions";
import {
  banSchema,
  createCategorySchema,
  createChannelSchema,
  createInviteSchema,
  createRoleSchema,
  createWorkspaceSchema,
  reorderSchema,
  searchQuerySchema,
  setMemberRolesSchema,
  transferOwnershipSchema,
  updateCategorySchema,
  updateMemberSchema,
  updateRoleSchema,
  updateWorkspaceSchema,
} from "@shared/schemas";
import type { AuditEntry, Ban, Channel, Invite, Member, Role, SearchResponse, WorkspaceDetail } from "@shared/types";
import { chunked } from "../lib/chunks";

export const workspaceRoutes = new Hono<AppEnv>();
workspaceRoutes.use("*", requireUser);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toRole(r: typeof schema.roles.$inferSelect): Role {
  return { id: r.id, workspaceId: r.workspaceId, name: r.name, colour: r.colour, position: r.position, permissions: r.permissions, isDefault: r.isDefault };
}

async function memberCount(db: AppEnv["Variables"]["db"], workspaceId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.workspaceMembers)
    .where(and(eq(schema.workspaceMembers.workspaceId, workspaceId), eq(schema.workspaceMembers.status, "active")));
  return Number(row?.count ?? 0);
}

async function buildWorkspaceDetail(db: AppEnv["Variables"]["db"], ctx: MemberContext): Promise<WorkspaceDetail> {
  const [categories, channelPerms, readStates, count, mentions] = await Promise.all([
    db.query.categories.findMany({ where: eq(schema.categories.workspaceId, ctx.workspaceId), orderBy: asc(schema.categories.position) }),
    resolveAllChannelPermissions(db, ctx),
    db.query.channelReadStates.findMany({ where: eq(schema.channelReadStates.userId, ctx.userId) }),
    memberCount(db, ctx.workspaceId),
    unreadMentionCounts(db, ctx.userId, "channel", ctx.workspaceId),
  ]);
  const readBy = new Map(readStates.map((r) => [r.channelId, r.lastReadSequence]));
  const channels: Channel[] = [...channelPerms.values()]
    .filter((e) => hasPermission(e.permissions, Permission.VIEW_CHANNEL))
    .sort((a, b) => a.channel.position - b.channel.position || a.channel.name.localeCompare(b.channel.name))
    .map(({ channel, permissions }) => ({
      id: channel.id,
      workspaceId: channel.workspaceId,
      categoryId: channel.categoryId,
      name: channel.name,
      topic: channel.topic,
      kind: channel.kind as "text" | "voice",
      position: channel.position,
      lastSequence: channel.lastSequence,
      permissions,
      lastReadSequence: readBy.get(channel.id) ?? 0,
      mentionCount: mentions.get(channel.id) ?? 0,
      slowmodeSeconds: channel.slowmodeSeconds,
    }));
  const visibleMentions = channels.reduce((sum, ch) => sum + ch.mentionCount, 0);
  let dmPeer = null;
  if (ctx.workspace.kind === "dm") {
    const pair = await db.query.dmPairs.findFirst({ where: eq(schema.dmPairs.workspaceId, ctx.workspaceId) });
    const peerId = pair ? (pair.userA === ctx.userId ? pair.userB : pair.userA) : null;
    const peer = peerId ? await db.query.users.findFirst({ where: eq(schema.users.id, peerId) }) : null;
    dmPeer = peer ? toUserSummary(peer) : null;
  }
  return {
    ...toWorkspaceSummary(ctx.workspace, count, visibleMentions),
    categories: categories.map((cat) => ({ id: cat.id, workspaceId: cat.workspaceId, name: cat.name, position: cat.position })),
    channels,
    roles: ctx.roles.sort((a, b) => b.position - a.position).map(toRole),
    myRoleIds: ctx.memberRoleIds,
    myPermissions: ctx.basePermissions,
    myNickname: ctx.member.nickname,
    createdAt: isoRequired(ctx.workspace.createdAt),
    dmPeer,
    wordFilter: hasPermission(ctx.basePermissions, Permission.MANAGE_WORKSPACE) ? ctx.workspace.wordFilter : "",
  };
}

async function listMembers(db: AppEnv["Variables"]["db"], workspaceId: string, ownerUserId: string): Promise<Member[]> {
  const rows = await db
    .select({ member: schema.workspaceMembers, user: schema.users })
    .from(schema.workspaceMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.workspaceMembers.userId))
    .where(and(eq(schema.workspaceMembers.workspaceId, workspaceId), eq(schema.workspaceMembers.status, "active")));
  const roleRows = await db.query.memberRoles.findMany({ where: eq(schema.memberRoles.workspaceId, workspaceId) });
  const rolesByUser = new Map<string, string[]>();
  for (const r of roleRows) rolesByUser.set(r.userId, [...(rolesByUser.get(r.userId) ?? []), r.roleId]);
  return rows.map(({ member, user }) => ({
    ...toUserSummary(user),
    userId: user.id,
    nickname: member.nickname,
    bio: user.bio,
    roleIds: rolesByUser.get(user.id) ?? [],
    joinedAt: isoRequired(member.joinedAt),
    timeoutUntil: iso(member.timeoutUntil),
    isOwner: user.id === ownerUserId,
  }));
}

function toInvite(row: typeof schema.invites.$inferSelect, creator: typeof schema.users.$inferSelect | undefined, appUrl: string): Invite {
  return {
    code: row.code,
    workspaceId: row.workspaceId,
    createdBy: creator ? toUserSummary(creator) : null,
    expiresAt: iso(row.expiresAt),
    maxUses: row.maxUses,
    uses: row.uses,
    revokedAt: iso(row.revokedAt),
    createdAt: isoRequired(row.createdAt),
    url: `${appUrl.replace(/\/$/, "")}/invite/${row.code}`,
  };
}

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

workspaceRoutes.post("/", async (c) => {
  const db = c.get("db");
  const user = c.get("user");
  checkRateLimit(`ws-create:${user.id}`, 5, 60 * 60 * 1000);
  const input = await parseBody(c, createWorkspaceSchema);
  if (!(await canCreateWorkspace(c.env.DB, user.id))) throw ApiError.forbidden("Only the server owner can create workspaces on this server");

  const owned = await db.select({ count: sql<number>`count(*)` }).from(schema.workspaces).where(and(eq(schema.workspaces.ownerUserId, user.id), eq(schema.workspaces.kind, "community")));
  if (Number(owned[0]?.count ?? 0) >= 25) throw ApiError.conflict("You have reached the maximum number of workspaces");

  const now = new Date();
  const workspaceId = newId();
  const slug = `${slugify(input.name)}-${workspaceId.slice(-6)}`;
  const everyoneRoleId = newId();
  const adminRoleId = newId();
  const textCategoryId = newId();
  const voiceCategoryId = newId();
  const generalId = newId();
  const loungeId = newId();

  if (input.iconKey && !input.iconKey.startsWith(`workspace-icons/${user.id}/`)) throw ApiError.forbidden("Icon key does not belong to you");

  await db.batch([
    db.insert(schema.workspaces).values({ id: workspaceId, name: input.name, slug, iconKey: input.iconKey ?? null, ownerUserId: user.id, createdAt: now, updatedAt: now }),
    db.insert(schema.workspaceMembers).values({ workspaceId, userId: user.id, joinedAt: now, status: "active" }),
    db.insert(schema.roles).values([
      { id: everyoneRoleId, workspaceId, name: "everyone", colour: null, position: 0, permissions: DEFAULT_ROLE_PERMISSIONS, isDefault: true, createdAt: now },
      { id: adminRoleId, workspaceId, name: "Admin", colour: "#e0a83c", position: 1, permissions: Permission.ADMINISTRATOR, isDefault: false, createdAt: now },
    ]),
    db.insert(schema.memberRoles).values({ workspaceId, userId: user.id, roleId: adminRoleId }),
    db.insert(schema.categories).values([
      { id: textCategoryId, workspaceId, name: "Text channels", position: 0 },
      { id: voiceCategoryId, workspaceId, name: "Voice channels", position: 1 },
      // Sections are what the UI calls categories.
    ]),
    db.insert(schema.channels).values([
      { id: generalId, workspaceId, categoryId: textCategoryId, name: "general", topic: "Say hello", kind: "text", position: 0, createdBy: user.id, createdAt: now },
      { id: loungeId, workspaceId, categoryId: voiceCategoryId, name: "Lounge", topic: null, kind: "voice", position: 0, createdBy: user.id, createdAt: now },
    ]),
  ]);

  track(c.env, { name: "workspace.created", workspaceId });
  const ctx = await requireMember(db, workspaceId, user.id);
  return c.json(await buildWorkspaceDetail(db, ctx), 201);
});

workspaceRoutes.get("/:workspaceId", async (c) => {
  const ctx = await requireMember(c.get("db"), c.req.param("workspaceId"), c.get("user").id);
  return c.json(await buildWorkspaceDetail(c.get("db"), ctx));
});

workspaceRoutes.patch("/:workspaceId", async (c) => {
  const db = c.get("db");
  const ctx = await requireMember(db, c.req.param("workspaceId"), c.get("user").id);
  requirePermission(ctx.basePermissions, Permission.MANAGE_WORKSPACE, "Manage workspace");
  const input = await parseBody(c, updateWorkspaceSchema);
  if (input.iconKey && !input.iconKey.startsWith(`workspace-icons/${ctx.userId}/`)) throw ApiError.forbidden("Icon key does not belong to you");
  if (input.iconKey && !(await c.env.UPLOADS.head(input.iconKey))) throw ApiError.validation(undefined, "Upload not found — did the transfer finish?");
  await db
    .update(schema.workspaces)
    .set({
      name: input.name ?? ctx.workspace.name,
      iconKey: input.iconKey === undefined ? ctx.workspace.iconKey : input.iconKey,
      wordFilter: input.wordFilter === undefined ? ctx.workspace.wordFilter : filterTerms(input.wordFilter).join("\n"),
      updatedAt: new Date(),
    })
    .where(eq(schema.workspaces.id, ctx.workspaceId));
  // The filtered words themselves stay out of the audit log.
  const { wordFilter, ...logged } = input;
  await audit(db, { workspaceId: ctx.workspaceId, actorUserId: ctx.userId, action: "workspace.updated", details: wordFilter === undefined ? logged : { ...logged, wordFilter: "updated" } });
  await notifyWorkspace(c.env, ctx.workspaceId, { type: "workspace.updated", reason: "workspace" });
  const fresh = await requireMember(db, ctx.workspaceId, ctx.userId);
  return c.json(await buildWorkspaceDetail(db, fresh));
});

workspaceRoutes.delete("/:workspaceId", async (c) => {
  const db = c.get("db");
  const ctx = await requireMember(db, c.req.param("workspaceId"), c.get("user").id);
  if (!ctx.isOwner) throw ApiError.forbidden("Only the owner can delete a workspace");
  await db.delete(schema.workspaces).where(eq(schema.workspaces.id, ctx.workspaceId));
  await c.env.BACKGROUND_QUEUE.send({ type: "workspace.deleted", workspaceId: ctx.workspaceId, r2Prefix: `attachments/${ctx.workspaceId}/` });
  await notifyWorkspace(c.env, ctx.workspaceId, { type: "workspace.updated", reason: "workspace" });
  return c.body(null, 204);
});

/** The owner hands the workspace to another member, e.g. before leaving or deleting their account. */
workspaceRoutes.post("/:workspaceId/owner", async (c) => {
  const db = c.get("db");
  const ctx = await requireMember(db, c.req.param("workspaceId"), c.get("user").id);
  if (!ctx.isOwner) throw ApiError.forbidden("Only the owner can transfer the workspace");
  const { userId } = await parseBody(c, transferOwnershipSchema);
  if (userId === ctx.userId) throw ApiError.validation(undefined, "You already own this workspace");
  const target = await loadMemberContext(db, ctx.workspaceId, userId);
  const account = target ? await db.query.users.findFirst({ where: eq(schema.users.id, userId) }) : null;
  if (!target || !account || account.suspendedAt || account.deletedAt) throw ApiError.validation(undefined, "The new owner must be an active member");
  await db.update(schema.workspaces).set({ ownerUserId: userId, updatedAt: new Date() }).where(eq(schema.workspaces.id, ctx.workspaceId));
  await audit(db, { workspaceId: ctx.workspaceId, actorUserId: ctx.userId, action: "workspace.owner_transferred", targetType: "user", targetId: userId });
  await notifyWorkspace(c.env, ctx.workspaceId, { type: "workspace.updated", reason: "members" });
  return c.body(null, 204);
});

workspaceRoutes.post("/:workspaceId/leave", async (c) => {
  const db = c.get("db");
  const ctx = await requireMember(db, c.req.param("workspaceId"), c.get("user").id);
  if (ctx.isOwner) throw ApiError.conflict("The owner cannot leave the workspace. Delete it or transfer ownership first.");
  await db.batch([
    db.delete(schema.memberRoles).where(and(eq(schema.memberRoles.workspaceId, ctx.workspaceId), eq(schema.memberRoles.userId, ctx.userId))),
    db.delete(schema.workspaceMembers).where(and(eq(schema.workspaceMembers.workspaceId, ctx.workspaceId), eq(schema.workspaceMembers.userId, ctx.userId))),
  ]);
  await notifyWorkspace(c.env, ctx.workspaceId, { type: "member.removed", userId: ctx.userId, reason: "left" });
  return c.body(null, 204);
});

// ---------------------------------------------------------------------------
// Categories & channels
// ---------------------------------------------------------------------------

workspaceRoutes.post("/:workspaceId/categories", async (c) => {
  const db = c.get("db");
  const ctx = await requireMember(db, c.req.param("workspaceId"), c.get("user").id);
  requireAnyPermission(ctx.basePermissions, [Permission.MANAGE_CHANNELS, Permission.MANAGE_LAYOUT], "Organise channels");
  const [existing] = await db.select({ count: sql<number>`count(*)` }).from(schema.categories).where(eq(schema.categories.workspaceId, ctx.workspaceId));
  if (Number(existing?.count ?? 0) >= 50) throw ApiError.conflict("Section limit reached");
  const input = await parseBody(c, createCategorySchema);
  const [max] = await db.select({ m: sql<number>`coalesce(max(position), -1)` }).from(schema.categories).where(eq(schema.categories.workspaceId, ctx.workspaceId));
  const id = newId();
  await db.insert(schema.categories).values({ id, workspaceId: ctx.workspaceId, name: input.name, position: Number(max?.m ?? -1) + 1 });
  await audit(db, { workspaceId: ctx.workspaceId, actorUserId: ctx.userId, action: "category.created", targetType: "category", targetId: id, details: { name: input.name } });
  await notifyWorkspace(c.env, ctx.workspaceId, { type: "workspace.updated", reason: "channels" });
  return c.json({ id, workspaceId: ctx.workspaceId, name: input.name, position: Number(max?.m ?? -1) + 1 }, 201);
});

workspaceRoutes.patch("/:workspaceId/categories/:categoryId", async (c) => {
  const db = c.get("db");
  const ctx = await requireMember(db, c.req.param("workspaceId"), c.get("user").id);
  requireAnyPermission(ctx.basePermissions, [Permission.MANAGE_CHANNELS, Permission.MANAGE_LAYOUT], "Organise channels");
  const input = await parseBody(c, updateCategorySchema);
  const existing = await db.query.categories.findFirst({ where: and(eq(schema.categories.id, c.req.param("categoryId")), eq(schema.categories.workspaceId, ctx.workspaceId)) });
  if (!existing) throw ApiError.notFound("Category");
  await db.update(schema.categories).set({ name: input.name ?? existing.name, position: input.position ?? existing.position }).where(eq(schema.categories.id, existing.id));
  await audit(db, { workspaceId: ctx.workspaceId, actorUserId: ctx.userId, action: "category.updated", targetType: "category", targetId: existing.id, details: input });
  await notifyWorkspace(c.env, ctx.workspaceId, { type: "workspace.updated", reason: "channels" });
  return c.json({ ok: true });
});

workspaceRoutes.delete("/:workspaceId/categories/:categoryId", async (c) => {
  const db = c.get("db");
  const ctx = await requireMember(db, c.req.param("workspaceId"), c.get("user").id);
  requirePermission(ctx.basePermissions, Permission.MANAGE_CHANNELS, "Manage channels");
  const existing = await db.query.categories.findFirst({ where: and(eq(schema.categories.id, c.req.param("categoryId")), eq(schema.categories.workspaceId, ctx.workspaceId)) });
  if (!existing) throw ApiError.notFound("Category");
  // Channels are kept and become uncategorised (FK is ON DELETE SET NULL).
  await db.delete(schema.categories).where(eq(schema.categories.id, existing.id));
  await audit(db, { workspaceId: ctx.workspaceId, actorUserId: ctx.userId, action: "category.deleted", targetType: "category", targetId: existing.id, details: { name: existing.name } });
  await notifyWorkspace(c.env, ctx.workspaceId, { type: "workspace.updated", reason: "channels" });
  return c.body(null, 204);
});

workspaceRoutes.post("/:workspaceId/channels", async (c) => {
  const db = c.get("db");
  const ctx = await requireMember(db, c.req.param("workspaceId"), c.get("user").id);
  requirePermission(ctx.basePermissions, Permission.MANAGE_CHANNELS, "Manage channels");
  const input = await parseBody(c, createChannelSchema);
  if (input.categoryId) {
    const cat = await db.query.categories.findFirst({ where: and(eq(schema.categories.id, input.categoryId), eq(schema.categories.workspaceId, ctx.workspaceId)) });
    if (!cat) throw ApiError.notFound("Category");
  }
  const [count] = await db.select({ count: sql<number>`count(*)` }).from(schema.channels).where(eq(schema.channels.workspaceId, ctx.workspaceId));
  if (Number(count?.count ?? 0) >= 200) throw ApiError.conflict("Channel limit reached");
  const [max] = await db.select({ m: sql<number>`coalesce(max(position), -1)` }).from(schema.channels).where(eq(schema.channels.workspaceId, ctx.workspaceId));
  const id = newId();
  const name = input.kind === "voice" ? input.name.replace(/-/g, " ") : input.name;
  await db.insert(schema.channels).values({
    id,
    workspaceId: ctx.workspaceId,
    categoryId: input.categoryId ?? null,
    name,
    topic: input.topic ?? null,
    kind: input.kind,
    position: Number(max?.m ?? -1) + 1,
    createdBy: ctx.userId,
    createdAt: new Date(),
  });
  await audit(db, { workspaceId: ctx.workspaceId, actorUserId: ctx.userId, action: "channel.created", targetType: "channel", targetId: id, details: { name, kind: input.kind } });
  await notifyWorkspace(c.env, ctx.workspaceId, { type: "workspace.updated", reason: "channels" });
  const detail = await buildWorkspaceDetail(db, ctx);
  return c.json(detail.channels.find((ch) => ch.id === id), 201);
});

workspaceRoutes.put("/:workspaceId/reorder", async (c) => {
  const db = c.get("db");
  const ctx = await requireMember(db, c.req.param("workspaceId"), c.get("user").id);
  requireAnyPermission(ctx.basePermissions, [Permission.MANAGE_CHANNELS, Permission.MANAGE_LAYOUT], "Organise channels");
  checkRateLimit(`reorder:${ctx.userId}`, 60, 60_000);
  const input = await parseBody(c, reorderSchema);
  // Channels may only be moved into sections that belong to this workspace.
  const targetCategoryIds = [...new Set((input.channels ?? []).map((ch) => ch.categoryId).filter((id): id is string => !!id))];
  if (targetCategoryIds.length) {
    const found = await db.select({ id: schema.categories.id }).from(schema.categories).where(and(eq(schema.categories.workspaceId, ctx.workspaceId), inArray(schema.categories.id, targetCategoryIds)));
    if (found.length !== targetCategoryIds.length) throw ApiError.notFound("Section");
  }
  const statements = [];
  for (const cat of input.categories ?? []) {
    statements.push(db.update(schema.categories).set({ position: cat.position }).where(and(eq(schema.categories.id, cat.id), eq(schema.categories.workspaceId, ctx.workspaceId))));
  }
  for (const ch of input.channels ?? []) {
    statements.push(db.update(schema.channels).set({ position: ch.position, categoryId: ch.categoryId }).where(and(eq(schema.channels.id, ch.id), eq(schema.channels.workspaceId, ctx.workspaceId))));
  }
  await batchAll(db, statements);
  await notifyWorkspace(c.env, ctx.workspaceId, { type: "workspace.updated", reason: "channels" });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

workspaceRoutes.get("/:workspaceId/members", async (c) => {
  const db = c.get("db");
  const ctx = await requireMember(db, c.req.param("workspaceId"), c.get("user").id);
  return c.json(await listMembers(db, ctx.workspaceId, ctx.workspace.ownerUserId));
});

workspaceRoutes.patch("/:workspaceId/members/:userId", async (c) => {
  const db = c.get("db");
  const ctx = await requireMember(db, c.req.param("workspaceId"), c.get("user").id);
  const targetId = c.req.param("userId");
  const input = await parseBody(c, updateMemberSchema);
  const isSelf = targetId === ctx.userId;
  if (!isSelf) {
    requirePermission(ctx.basePermissions, Permission.KICK_MEMBERS, "Kick members");
    const target = await loadMemberContext(db, ctx.workspaceId, targetId);
    if (!target) throw ApiError.notFound("Member");
    if (!canModerate(ctx, target)) throw ApiError.forbidden("You cannot moderate this member");
  } else if (input.timeoutUntil !== undefined) {
    throw ApiError.forbidden("You cannot change your own timeout");
  }
  await db
    .update(schema.workspaceMembers)
    .set({
      ...(input.nickname !== undefined ? { nickname: input.nickname || null } : {}),
      ...(input.timeoutUntil !== undefined ? { timeoutUntil: input.timeoutUntil ? new Date(input.timeoutUntil) : null } : {}),
    })
    .where(and(eq(schema.workspaceMembers.workspaceId, ctx.workspaceId), eq(schema.workspaceMembers.userId, targetId)));
  if (!isSelf) await audit(db, { workspaceId: ctx.workspaceId, actorUserId: ctx.userId, action: "member.updated", targetType: "user", targetId, details: input });
  await notifyWorkspace(c.env, ctx.workspaceId, { type: "workspace.updated", reason: "members" });
  return c.json({ ok: true });
});

workspaceRoutes.put("/:workspaceId/members/:userId/roles", async (c) => {
  const db = c.get("db");
  const ctx = await requireMember(db, c.req.param("workspaceId"), c.get("user").id);
  requirePermission(ctx.basePermissions, Permission.MANAGE_ROLES, "Manage roles");
  const targetId = c.req.param("userId");
  const { roleIds } = await parseBody(c, setMemberRolesSchema);
  const target = await loadMemberContext(db, ctx.workspaceId, targetId);
  if (!target) throw ApiError.notFound("Member");
  const wanted = ctx.roles.filter((r) => roleIds.includes(r.id) && !r.isDefault);
  if (wanted.length !== new Set(roleIds).size) throw ApiError.validation(undefined, "Unknown role");
  // Only roles below the actor's highest role can be granted or removed.
  const changed = [...wanted.filter((r) => !target.memberRoleIds.includes(r.id)), ...ctx.roles.filter((r) => target.memberRoleIds.includes(r.id) && !roleIds.includes(r.id))];
  for (const role of changed) if (!canManageRole(ctx, role)) throw ApiError.forbidden(`You cannot assign the ${role.name} role`);
  await batchAll(db, [
    db.delete(schema.memberRoles).where(and(eq(schema.memberRoles.workspaceId, ctx.workspaceId), eq(schema.memberRoles.userId, targetId))),
    ...(wanted.length ? [db.insert(schema.memberRoles).values(wanted.map((r) => ({ workspaceId: ctx.workspaceId, userId: targetId, roleId: r.id })))] : []),
  ]);
  await audit(db, { workspaceId: ctx.workspaceId, actorUserId: ctx.userId, action: "member.roles_updated", targetType: "user", targetId, details: { roleIds } });
  await notifyWorkspace(c.env, ctx.workspaceId, { type: "workspace.updated", reason: "members" });
  return c.json({ ok: true });
});

workspaceRoutes.delete("/:workspaceId/members/:userId", async (c) => {
  const db = c.get("db");
  const ctx = await requireMember(db, c.req.param("workspaceId"), c.get("user").id);
  requirePermission(ctx.basePermissions, Permission.KICK_MEMBERS, "Kick members");
  const targetId = c.req.param("userId");
  const target = await loadMemberContext(db, ctx.workspaceId, targetId);
  if (!target) throw ApiError.notFound("Member");
  if (!canModerate(ctx, target)) throw ApiError.forbidden("You cannot kick this member");
  await db.batch([
    db.delete(schema.memberRoles).where(and(eq(schema.memberRoles.workspaceId, ctx.workspaceId), eq(schema.memberRoles.userId, targetId))),
    db.delete(schema.workspaceMembers).where(and(eq(schema.workspaceMembers.workspaceId, ctx.workspaceId), eq(schema.workspaceMembers.userId, targetId))),
  ]);
  await audit(db, { workspaceId: ctx.workspaceId, actorUserId: ctx.userId, action: "member.kicked", targetType: "user", targetId });
  await notifyWorkspace(c.env, ctx.workspaceId, { type: "member.removed", userId: targetId, reason: "kicked" });
  return c.body(null, 204);
});

// ---------------------------------------------------------------------------
// Bans
// ---------------------------------------------------------------------------

workspaceRoutes.get("/:workspaceId/bans", async (c) => {
  const db = c.get("db");
  const ctx = await requireMember(db, c.req.param("workspaceId"), c.get("user").id);
  requirePermission(ctx.basePermissions, Permission.BAN_MEMBERS, "Ban members");
  const rows = await db.query.bans.findMany({ where: eq(schema.bans.workspaceId, ctx.workspaceId), orderBy: desc(schema.bans.createdAt) });
  const userIds = [...new Set(rows.flatMap((b) => [b.userId, b.bannedBy]))];
  const users = await chunked(userIds, (ids) => db.select().from(schema.users).where(inArray(schema.users.id, ids)));
  const byId = new Map(users.map((u) => [u.id, u]));
  const body: Ban[] = rows.map((b) => ({
    userId: b.userId,
    user: byId.has(b.userId) ? toUserSummary(byId.get(b.userId)!) : null,
    bannedBy: byId.has(b.bannedBy) ? toUserSummary(byId.get(b.bannedBy)!) : null,
    reason: b.reason,
    createdAt: isoRequired(b.createdAt),
  }));
  return c.json(body);
});

workspaceRoutes.put("/:workspaceId/bans/:userId", async (c) => {
  const db = c.get("db");
  const ctx = await requireMember(db, c.req.param("workspaceId"), c.get("user").id);
  requirePermission(ctx.basePermissions, Permission.BAN_MEMBERS, "Ban members");
  const targetId = c.req.param("userId");
  const input = await parseBody(c, banSchema);
  if (targetId === ctx.userId) throw ApiError.conflict("You cannot ban yourself");
  if (targetId === ctx.workspace.ownerUserId) throw ApiError.forbidden("The owner cannot be banned");
  const target = await loadMemberContext(db, ctx.workspaceId, targetId);
  if (target && !canModerate(ctx, target)) throw ApiError.forbidden("You cannot ban this member");
  const statements: unknown[] = [
    db.insert(schema.bans).values({ workspaceId: ctx.workspaceId, userId: targetId, bannedBy: ctx.userId, reason: input.reason ?? null, createdAt: new Date() }).onConflictDoNothing(),
    db.delete(schema.memberRoles).where(and(eq(schema.memberRoles.workspaceId, ctx.workspaceId), eq(schema.memberRoles.userId, targetId))),
    db.delete(schema.workspaceMembers).where(and(eq(schema.workspaceMembers.workspaceId, ctx.workspaceId), eq(schema.workspaceMembers.userId, targetId))),
  ];
  if (input.deleteRecentMessages) {
    const since = Date.now() - 24 * 60 * 60 * 1000;
    statements.push(
      db.update(schema.messages).set({ deletedAt: new Date(), content: "" }).where(and(eq(schema.messages.workspaceId, ctx.workspaceId), eq(schema.messages.authorUserId, targetId), sql`${schema.messages.createdAt} > ${since}`)),
    );
  }
  await batchAll(db, statements);
  await audit(db, { workspaceId: ctx.workspaceId, actorUserId: ctx.userId, action: "member.banned", targetType: "user", targetId, details: { reason: input.reason ?? null } });
  await notifyWorkspace(c.env, ctx.workspaceId, { type: "member.removed", userId: targetId, reason: "banned" });
  return c.json({ ok: true });
});

workspaceRoutes.delete("/:workspaceId/bans/:userId", async (c) => {
  const db = c.get("db");
  const ctx = await requireMember(db, c.req.param("workspaceId"), c.get("user").id);
  requirePermission(ctx.basePermissions, Permission.BAN_MEMBERS, "Ban members");
  const targetId = c.req.param("userId");
  await db.delete(schema.bans).where(and(eq(schema.bans.workspaceId, ctx.workspaceId), eq(schema.bans.userId, targetId)));
  await audit(db, { workspaceId: ctx.workspaceId, actorUserId: ctx.userId, action: "member.unbanned", targetType: "user", targetId });
  return c.body(null, 204);
});

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

workspaceRoutes.get("/:workspaceId/roles", async (c) => {
  const ctx = await requireMember(c.get("db"), c.req.param("workspaceId"), c.get("user").id);
  return c.json(ctx.roles.sort((a, b) => b.position - a.position).map(toRole));
});

workspaceRoutes.post("/:workspaceId/roles", async (c) => {
  const db = c.get("db");
  const ctx = await requireMember(db, c.req.param("workspaceId"), c.get("user").id);
  requirePermission(ctx.basePermissions, Permission.MANAGE_ROLES, "Manage roles");
  const input = await parseBody(c, createRoleSchema);
  const permissions = (input.permissions ?? 0) & ALL_PERMISSIONS;
  // A manager can only grant permissions they hold themselves.
  if (!ctx.isOwner && (permissions & ~ctx.basePermissions) !== 0 && !hasPermission(ctx.basePermissions, Permission.ADMINISTRATOR)) {
    throw ApiError.forbidden("You cannot grant permissions you do not have");
  }
  if (ctx.roles.length >= 50) throw ApiError.conflict("Role limit reached");
  // New roles slot in just below the actor's highest role.
  const position = ctx.isOwner ? Math.max(1, ...ctx.roles.map((r) => r.position + 1)) : Math.max(1, ctx.highestRolePosition);
  const id = newId();
  const now = new Date();
  await db.batch([
    db.update(schema.roles).set({ position: sql`${schema.roles.position} + 1` }).where(and(eq(schema.roles.workspaceId, ctx.workspaceId), sql`${schema.roles.position} >= ${position}`)),
    db.insert(schema.roles).values({ id, workspaceId: ctx.workspaceId, name: input.name, colour: input.colour ?? null, position, permissions, isDefault: false, createdAt: now }),
  ]);
  await audit(db, { workspaceId: ctx.workspaceId, actorUserId: ctx.userId, action: "role.created", targetType: "role", targetId: id, details: { name: input.name, permissions } });
  await notifyWorkspace(c.env, ctx.workspaceId, { type: "workspace.updated", reason: "roles" });
  return c.json(toRole({ id, workspaceId: ctx.workspaceId, name: input.name, colour: input.colour ?? null, position, permissions, isDefault: false, createdAt: now }), 201);
});

workspaceRoutes.patch("/:workspaceId/roles/:roleId", async (c) => {
  const db = c.get("db");
  const ctx = await requireMember(db, c.req.param("workspaceId"), c.get("user").id);
  requirePermission(ctx.basePermissions, Permission.MANAGE_ROLES, "Manage roles");
  const role = ctx.roles.find((r) => r.id === c.req.param("roleId"));
  if (!role) throw ApiError.notFound("Role");
  if (!role.isDefault && !canManageRole(ctx, role)) throw ApiError.forbidden("You cannot edit a role above your own");
  const input = await parseBody(c, updateRoleSchema);
  let permissions = role.permissions;
  if (input.permissions !== undefined) {
    permissions = input.permissions & ALL_PERMISSIONS;
    if (!ctx.isOwner && !hasPermission(ctx.basePermissions, Permission.ADMINISTRATOR) && ((permissions & ~role.permissions) & ~ctx.basePermissions) !== 0) {
      throw ApiError.forbidden("You cannot grant permissions you do not have");
    }
    if (role.isDefault && (permissions & Permission.ADMINISTRATOR) !== 0) throw ApiError.validation(undefined, "The everyone role cannot be an administrator");
  }
  if (role.isDefault && input.position !== undefined && input.position !== 0) throw ApiError.validation(undefined, "The everyone role stays at the bottom");
  let position = role.position;
  if (input.position !== undefined && !role.isDefault) {
    const maxPos = ctx.isOwner ? Number.MAX_SAFE_INTEGER : ctx.highestRolePosition - 1;
    position = Math.max(1, Math.min(input.position, maxPos));
  }
  await db
    .update(schema.roles)
    .set({ name: role.isDefault ? role.name : input.name ?? role.name, colour: input.colour === undefined ? role.colour : input.colour, permissions, position })
    .where(eq(schema.roles.id, role.id));
  await audit(db, { workspaceId: ctx.workspaceId, actorUserId: ctx.userId, action: "role.updated", targetType: "role", targetId: role.id, details: { ...input, permissions } });
  await notifyWorkspace(c.env, ctx.workspaceId, { type: "workspace.updated", reason: "roles" });
  return c.json(toRole({ ...role, name: role.isDefault ? role.name : input.name ?? role.name, colour: input.colour === undefined ? role.colour : input.colour, permissions, position }));
});

workspaceRoutes.delete("/:workspaceId/roles/:roleId", async (c) => {
  const db = c.get("db");
  const ctx = await requireMember(db, c.req.param("workspaceId"), c.get("user").id);
  requirePermission(ctx.basePermissions, Permission.MANAGE_ROLES, "Manage roles");
  const role = ctx.roles.find((r) => r.id === c.req.param("roleId"));
  if (!role) throw ApiError.notFound("Role");
  if (role.isDefault) throw ApiError.validation(undefined, "The everyone role cannot be deleted");
  if (!canManageRole(ctx, role)) throw ApiError.forbidden("You cannot delete a role above your own");
  await db.delete(schema.roles).where(eq(schema.roles.id, role.id));
  await audit(db, { workspaceId: ctx.workspaceId, actorUserId: ctx.userId, action: "role.deleted", targetType: "role", targetId: role.id, details: { name: role.name } });
  await notifyWorkspace(c.env, ctx.workspaceId, { type: "workspace.updated", reason: "roles" });
  return c.body(null, 204);
});

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

workspaceRoutes.get("/:workspaceId/invites", async (c) => {
  const db = c.get("db");
  const ctx = await requireMember(db, c.req.param("workspaceId"), c.get("user").id);
  requirePermission(ctx.basePermissions, Permission.CREATE_INVITES, "Create invites");
  const canSeeAll = hasPermission(ctx.basePermissions, Permission.MANAGE_WORKSPACE);
  const rows = await db.query.invites.findMany({
    where: canSeeAll ? and(eq(schema.invites.workspaceId, ctx.workspaceId), isNull(schema.invites.revokedAt)) : and(eq(schema.invites.workspaceId, ctx.workspaceId), eq(schema.invites.createdBy, ctx.userId), isNull(schema.invites.revokedAt)),
    orderBy: desc(schema.invites.createdAt),
  });
  const creatorIds = [...new Set(rows.map((r) => r.createdBy))];
  const creators = await chunked(creatorIds, (ids) => db.select().from(schema.users).where(inArray(schema.users.id, ids)));
  const byId = new Map(creators.map((u) => [u.id, u]));
  return c.json(rows.map((r) => toInvite(r, byId.get(r.createdBy), c.get("origin"))));
});

workspaceRoutes.post("/:workspaceId/invites", async (c) => {
  const db = c.get("db");
  const ctx = await requireMember(db, c.req.param("workspaceId"), c.get("user").id);
  requirePermission(ctx.basePermissions, Permission.CREATE_INVITES, "Create invites");
  checkRateLimit(`invite:${ctx.userId}`, 20, 60 * 60 * 1000);
  const input = await parseBody(c, createInviteSchema);
  const expiresIn = input.expiresIn === undefined ? 7 * 24 * 3600 : input.expiresIn;
  const row = {
    code: newInviteCode(),
    workspaceId: ctx.workspaceId,
    createdBy: ctx.userId,
    expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
    maxUses: input.maxUses ?? null,
    uses: 0,
    revokedAt: null,
    createdAt: new Date(),
  };
  await db.insert(schema.invites).values(row);
  await audit(db, { workspaceId: ctx.workspaceId, actorUserId: ctx.userId, action: "invite.created", targetType: "invite", targetId: row.code, details: { expiresAt: iso(row.expiresAt), maxUses: row.maxUses } });
  return c.json(toInvite(row, c.get("user"), c.get("origin")), 201);
});

workspaceRoutes.delete("/:workspaceId/invites/:code", async (c) => {
  const db = c.get("db");
  const ctx = await requireMember(db, c.req.param("workspaceId"), c.get("user").id);
  const invite = await db.query.invites.findFirst({ where: and(eq(schema.invites.code, c.req.param("code")), eq(schema.invites.workspaceId, ctx.workspaceId)) });
  if (!invite) throw ApiError.notFound("Invite");
  if (invite.createdBy !== ctx.userId) requirePermission(ctx.basePermissions, Permission.MANAGE_WORKSPACE, "Manage workspace");
  await db.update(schema.invites).set({ revokedAt: new Date() }).where(eq(schema.invites.code, invite.code));
  await audit(db, { workspaceId: ctx.workspaceId, actorUserId: ctx.userId, action: "invite.revoked", targetType: "invite", targetId: invite.code });
  return c.body(null, 204);
});

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

workspaceRoutes.get("/:workspaceId/audit-log", async (c) => {
  const db = c.get("db");
  const ctx = await requireMember(db, c.req.param("workspaceId"), c.get("user").id);
  requirePermission(ctx.basePermissions, Permission.MANAGE_WORKSPACE, "Manage workspace");
  const rows = await db.query.auditLog.findMany({ where: eq(schema.auditLog.workspaceId, ctx.workspaceId), orderBy: desc(schema.auditLog.createdAt), limit: 100 });
  const actorIds = [...new Set(rows.map((r) => r.actorUserId))];
  const actors = await chunked(actorIds, (ids) => db.select().from(schema.users).where(inArray(schema.users.id, ids)));
  const byId = new Map(actors.map((u) => [u.id, u]));
  const body: AuditEntry[] = rows.map((r) => ({
    id: r.id,
    actor: byId.has(r.actorUserId) ? toUserSummary(byId.get(r.actorUserId)!) : null,
    action: r.action,
    targetType: r.targetType,
    targetId: r.targetId,
    details: r.details ?? null,
    createdAt: isoRequired(r.createdAt),
  }));
  return c.json(body);
});

// ---------------------------------------------------------------------------
// Search (D1 FTS5)
// ---------------------------------------------------------------------------

workspaceRoutes.get("/:workspaceId/search", async (c) => {
  const db = c.get("db");
  const ctx = await requireMember(db, c.req.param("workspaceId"), c.get("user").id);
  checkRateLimit(`search:${ctx.userId}`, 60, 60 * 1000);
  const q = parseQuery(c, searchQuerySchema);
  const visible = await visibleChannelIds(db, ctx);
  const channelIds = q.channelId ? visible.filter((id) => id === q.channelId) : visible;
  if (channelIds.length === 0) return c.json({ results: [], total: 0 } satisfies SearchResponse);

  const ftsQuery = toFtsQuery(q.q);
  if (!ftsQuery) return c.json({ results: [], total: 0 } satisfies SearchResponse);

  const placeholders = channelIds.map(() => "?").join(",");
  const authorClause = q.authorId ? " AND f.author_user_id = ?" : "";
  const params: unknown[] = [ftsQuery, ctx.workspaceId, ...channelIds, ...(q.authorId ? [q.authorId] : [])];

  const countStmt = c.env.DB.prepare(
    `SELECT count(*) AS total FROM messages_fts f JOIN messages m ON m.id = f.message_id
     WHERE messages_fts MATCH ? AND f.workspace_id = ? AND f.channel_id IN (${placeholders})${authorClause} AND m.deleted_at IS NULL`,
  ).bind(...params);
  const rowsStmt = c.env.DB.prepare(
    `SELECT m.*, snippet(messages_fts, 0, '\u0001', '\u0002', '…', 24) AS snippet, c.name AS channel_name
     FROM messages_fts f JOIN messages m ON m.id = f.message_id JOIN channels c ON c.id = m.channel_id
     WHERE messages_fts MATCH ? AND f.workspace_id = ? AND f.channel_id IN (${placeholders})${authorClause} AND m.deleted_at IS NULL
     ORDER BY m.created_at DESC LIMIT ? OFFSET ?`,
  ).bind(...params, q.limit, q.offset);

  const [countRes, rowsRes] = await c.env.DB.batch([countStmt, rowsStmt]);
  const total = Number((countRes.results[0] as { total: number } | undefined)?.total ?? 0);
  const raw = rowsRes.results as Array<Record<string, unknown>>;
  // Load the full rows by id (keeps up with new columns), in the search's order.
  const found = await chunked(raw.map((r) => r.id as string), (ids) => db.select().from(schema.messages).where(inArray(schema.messages.id, ids)));
  const byId = new Map(found.map((r) => [r.id, r]));
  const rows = raw.map((r) => byId.get(r.id as string)).filter((r): r is NonNullable<typeof r> => !!r);
  const messages = await hydrateMessages(db, rows, ctx.userId);
  const body: SearchResponse = {
    total,
    results: messages.map((m) => {
      const hit = raw.find((r) => r.id === m.id)!;
      return { message: m, channelName: hit.channel_name as string, snippet: hit.snippet as string };
    }),
  };
  return c.json(body);
});

/** Turns free text into a safe FTS5 query: each term quoted, prefix-matched. */
export function toFtsQuery(input: string): string | null {
  const terms = input
    .split(/\s+/)
    .map((t) => t.replace(/["*]/g, "").trim())
    .filter((t) => t.length > 0)
    .slice(0, 8);
  if (terms.length === 0) return null;
  return terms.map((t) => `"${t}"*`).join(" ");
}

export { buildWorkspaceDetail, listMembers, fileUrl };
