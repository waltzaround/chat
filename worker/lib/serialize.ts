import type { UserSummary, CurrentUser, PreferredStatus, WorkspaceSummary } from "@shared/types";
import type { schema } from "@db/schema";

type UserRow = typeof schema.users.$inferSelect;
type WorkspaceRow = typeof schema.workspaces.$inferSelect;

export function iso(d: Date | number | null | undefined): string | null {
  if (d == null) return null;
  return (typeof d === "number" ? new Date(d) : d).toISOString();
}

export function isoRequired(d: Date | number): string {
  return (typeof d === "number" ? new Date(d) : d).toISOString();
}

export function fileUrl(key: string | null | undefined): string | null {
  return key ? `/api/files/${key}` : null;
}

export function avatarUrl(u: { avatarKey: string | null; image: string | null }): string | null {
  return fileUrl(u.avatarKey) ?? u.image ?? null;
}

export function toUserSummary(u: Pick<UserRow, "id" | "username" | "displayName" | "avatarKey" | "image">): UserSummary {
  return { id: u.id, username: u.username, displayName: u.displayName, avatarUrl: avatarUrl(u) };
}

export function toCurrentUser(u: UserRow, server: { ownerId: string | null; canCreateWorkspace: boolean; hasPassword: boolean }): CurrentUser {
  return {
    ...toUserSummary(u),
    isServerOwner: server.ownerId === u.id,
    canCreateWorkspace: server.canCreateWorkspace,
    hasPassword: server.hasPassword,
    email: u.email,
    bio: u.bio,
    status: (u.status as PreferredStatus) ?? "online",
    createdAt: isoRequired(u.createdAt),
  };
}

export function toWorkspaceSummary(w: WorkspaceRow, memberCount: number, mentionCount = 0): WorkspaceSummary {
  return {
    id: w.id,
    name: w.name,
    slug: w.slug,
    iconUrl: fileUrl(w.iconKey),
    ownerUserId: w.ownerUserId,
    memberCount,
    mentionCount,
    kind: w.kind === "dm" ? "dm" : "community",
  };
}
