import type { Member, Role, WorkspaceDetail } from "@shared/types";
import { Permission, hasPermission } from "@shared/permissions";

export { Permission, hasPermission };

/** Highest-positioned role with a colour, or null. */
export function roleColour(roleIds: string[], roles: Role[]): string | null {
  let best: Role | null = null;
  for (const r of roles) {
    if (!r.colour || !roleIds.includes(r.id)) continue;
    if (!best || r.position > best.position) best = r;
  }
  return best?.colour ?? null;
}

export function highestRole(roleIds: string[], roles: Role[]): Role | null {
  let best: Role | null = null;
  for (const r of roles) {
    if (r.isDefault || !roleIds.includes(r.id)) continue;
    if (!best || r.position > best.position) best = r;
  }
  return best;
}

export function memberDisplayName(m: { nickname: string | null; displayName: string }): string {
  return m.nickname ?? m.displayName;
}

export function can(ws: WorkspaceDetail | undefined, permission: number): boolean {
  return !!ws && hasPermission(ws.myPermissions, permission);
}

export function canModerateMember(ws: WorkspaceDetail, meId: string, myRoleIds: string[], target: Member): boolean {
  if (target.isOwner) return false;
  if (ws.ownerUserId === meId) return true;
  const mine = highestRole(myRoleIds, ws.roles)?.position ?? 0;
  const theirs = highestRole(target.roleIds, ws.roles)?.position ?? 0;
  return mine > theirs;
}
