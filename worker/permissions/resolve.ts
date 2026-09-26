/**
 * The single place where membership and permissions are resolved on the server.
 * Every API handler and the WorkspaceHub go through these helpers.
 */
import { and, eq, inArray } from "drizzle-orm";
import {
  ALL_PERMISSIONS,
  Permission,
  applyChannelOverwrites,
  computeBasePermissions,
  hasPermission,
  type OverwriteLike,
  type PermissionBits,
} from "@shared/permissions";
import { schema, type Db } from "../db";
import { ApiError } from "../lib/errors";

export type RoleRow = typeof schema.roles.$inferSelect;
export type ChannelRow = typeof schema.channels.$inferSelect;
export type MemberRow = typeof schema.workspaceMembers.$inferSelect;
export type WorkspaceRow = typeof schema.workspaces.$inferSelect;

export interface MemberContext {
  workspace: WorkspaceRow;
  member: MemberRow;
  userId: string;
  workspaceId: string;
  isOwner: boolean;
  roles: RoleRow[];
  everyoneRole: RoleRow | null;
  memberRoleIds: string[];
  /** Workspace-level permissions before channel overwrites. */
  basePermissions: PermissionBits;
  /** Position of the member's highest role (owner => Infinity). */
  highestRolePosition: number;
  isTimedOut: boolean;
}

export async function loadMemberContext(db: Db, workspaceId: string, userId: string): Promise<MemberContext | null> {
  const workspace = await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, workspaceId) });
  if (!workspace) return null;
  const member = await db.query.workspaceMembers.findFirst({
    where: and(eq(schema.workspaceMembers.workspaceId, workspaceId), eq(schema.workspaceMembers.userId, userId)),
  });
  if (!member || member.status !== "active") return null;

  const [roles, memberRoleRows] = await Promise.all([
    db.query.roles.findMany({ where: eq(schema.roles.workspaceId, workspaceId) }),
    db.query.memberRoles.findMany({
      where: and(eq(schema.memberRoles.workspaceId, workspaceId), eq(schema.memberRoles.userId, userId)),
    }),
  ]);
  return buildContext(workspace, member, roles, memberRoleRows.map((r) => r.roleId));
}

export function buildContext(
  workspace: WorkspaceRow,
  member: MemberRow,
  roles: RoleRow[],
  memberRoleIds: string[],
): MemberContext {
  const everyoneRole = roles.find((r) => r.isDefault) ?? null;
  // Nobody owns a direct message conversation: both people get the same, plain permissions.
  const isOwner = workspace.kind !== "dm" && workspace.ownerUserId === member.userId;
  const held = roles.filter((r) => memberRoleIds.includes(r.id));
  const basePermissions = computeBasePermissions({ isOwner, everyoneRole, memberRoles: held });
  const highestRolePosition = isOwner ? Number.POSITIVE_INFINITY : Math.max(0, ...held.map((r) => r.position));
  const isTimedOut = !!member.timeoutUntil && member.timeoutUntil.getTime() > Date.now();
  return {
    workspace,
    member,
    userId: member.userId,
    workspaceId: workspace.id,
    isOwner,
    roles,
    everyoneRole,
    memberRoleIds,
    basePermissions,
    highestRolePosition,
    isTimedOut,
  };
}

export async function requireMember(db: Db, workspaceId: string, userId: string): Promise<MemberContext> {
  const ctx = await loadMemberContext(db, workspaceId, userId);
  if (!ctx) throw ApiError.notFound("Workspace");
  return ctx;
}

export function requirePermission(bits: PermissionBits, permission: PermissionBits, what?: string): void {
  if (!hasPermission(bits, permission)) {
    throw ApiError.forbidden(what ? `You need the ${what} permission` : undefined);
  }
}

/** Passes when the member holds any of the given permissions (or ADMINISTRATOR). */
export function requireAnyPermission(bits: PermissionBits, permissions: PermissionBits[], what?: string): void {
  if (!permissions.some((p) => hasPermission(bits, p))) {
    throw ApiError.forbidden(what ? `You need the ${what} permission` : undefined);
  }
}

export function toOverwriteLike(rows: (typeof schema.channelPermissionOverwrites.$inferSelect)[]): OverwriteLike[] {
  return rows.map((o) => ({
    targetType: o.targetType as "role" | "user",
    targetId: o.targetId,
    allow: o.allowPermissions,
    deny: o.denyPermissions,
  }));
}

export function channelPermissions(ctx: MemberContext, overwrites: OverwriteLike[]): PermissionBits {
  const bits = applyChannelOverwrites({
    base: ctx.basePermissions,
    userId: ctx.userId,
    everyoneRoleId: ctx.everyoneRole?.id ?? null,
    memberRoleIds: ctx.memberRoleIds,
    overwrites,
  });
  if (ctx.isTimedOut && !hasPermission(bits, Permission.ADMINISTRATOR)) {
    // A timed-out member can still read but cannot interact.
    return bits & ~(Permission.SEND_MESSAGES | Permission.ADD_REACTIONS | Permission.ATTACH_FILES | Permission.SPEAK | Permission.VIDEO | Permission.SCREEN_SHARE);
  }
  return bits;
}

export interface ChannelAccess {
  channel: ChannelRow;
  permissions: PermissionBits;
  ctx: MemberContext;
}

/**
 * Loads a channel, verifies the user is a member of its workspace, and
 * resolves their effective permissions in that channel.
 */
export async function loadChannelAccess(db: Db, channelId: string, userId: string): Promise<ChannelAccess | null> {
  const channel = await db.query.channels.findFirst({ where: eq(schema.channels.id, channelId) });
  if (!channel) return null;
  const ctx = await loadMemberContext(db, channel.workspaceId, userId);
  if (!ctx) return null;
  const overwrites = await db.query.channelPermissionOverwrites.findMany({
    where: eq(schema.channelPermissionOverwrites.channelId, channelId),
  });
  return { channel, ctx, permissions: channelPermissions(ctx, toOverwriteLike(overwrites)) };
}

/** Like loadChannelAccess but throws 404 when the channel is not visible to the user. */
export async function requireChannelAccess(
  db: Db,
  channelId: string,
  userId: string,
  required: PermissionBits = Permission.VIEW_CHANNEL,
): Promise<ChannelAccess> {
  const access = await loadChannelAccess(db, channelId, userId);
  // Hide the existence of channels the user cannot see.
  if (!access || !hasPermission(access.permissions, Permission.VIEW_CHANNEL)) throw ApiError.notFound("Channel");
  requirePermission(access.permissions, required);
  return access;
}

/** Resolves permissions for every channel in the workspace in two queries. */
export async function resolveAllChannelPermissions(
  db: Db,
  ctx: MemberContext,
): Promise<Map<string, { channel: ChannelRow; permissions: PermissionBits }>> {
  const channels = await db.query.channels.findMany({ where: eq(schema.channels.workspaceId, ctx.workspaceId) });
  const ids = channels.map((c) => c.id);
  const overwrites = ids.length
    ? await db.query.channelPermissionOverwrites.findMany({
        where: inArray(schema.channelPermissionOverwrites.channelId, ids),
      })
    : [];
  const byChannel = new Map<string, OverwriteLike[]>();
  for (const o of overwrites) {
    const list = byChannel.get(o.channelId) ?? [];
    list.push({ targetType: o.targetType as "role" | "user", targetId: o.targetId, allow: o.allowPermissions, deny: o.denyPermissions });
    byChannel.set(o.channelId, list);
  }
  const out = new Map<string, { channel: ChannelRow; permissions: PermissionBits }>();
  for (const channel of channels) {
    out.set(channel.id, { channel, permissions: channelPermissions(ctx, byChannel.get(channel.id) ?? []) });
  }
  return out;
}

export async function visibleChannelIds(db: Db, ctx: MemberContext): Promise<string[]> {
  const all = await resolveAllChannelPermissions(db, ctx);
  return [...all.values()].filter((e) => hasPermission(e.permissions, Permission.VIEW_CHANNEL)).map((e) => e.channel.id);
}

/**
 * Role hierarchy check: a member may only act on roles strictly below their
 * own highest role (owner and ADMINISTRATOR bypass position but never the owner).
 */
export function canManageRole(ctx: MemberContext, role: RoleRow): boolean {
  if (ctx.isOwner) return true;
  if (!hasPermission(ctx.basePermissions, Permission.MANAGE_ROLES)) return false;
  return role.position < ctx.highestRolePosition;
}

/** A member may only moderate members whose highest role is below their own. */
export function canModerate(actor: MemberContext, target: MemberContext): boolean {
  if (target.isOwner) return false;
  if (actor.isOwner) return true;
  return actor.highestRolePosition > target.highestRolePosition;
}

export { ALL_PERMISSIONS, Permission, hasPermission };
