import { newId } from "@shared/id";
import { schema, type Db } from "../db";

export type AuditAction =
  | "workspace.updated"
  | "workspace.deleted"
  | "channel.created"
  | "channel.updated"
  | "channel.deleted"
  | "category.created"
  | "category.updated"
  | "category.deleted"
  | "channel.overwrite_set"
  | "channel.overwrite_removed"
  | "role.created"
  | "role.updated"
  | "role.deleted"
  | "member.roles_updated"
  | "member.updated"
  | "member.kicked"
  | "member.banned"
  | "member.unbanned"
  | "message.deleted_by_moderator"
  | "invite.created"
  | "invite.revoked";

export async function audit(
  db: Db,
  entry: {
    workspaceId: string;
    actorUserId: string;
    action: AuditAction;
    targetType?: string;
    targetId?: string;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(schema.auditLog).values({
    id: newId(),
    workspaceId: entry.workspaceId,
    actorUserId: entry.actorUserId,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    details: entry.details ?? null,
    createdAt: new Date(),
  });
}
