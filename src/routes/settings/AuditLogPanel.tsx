import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useAuditLog } from "@/lib/queries";
import { UserAvatar } from "@/components/common/UserAvatar";
import { formatFull } from "@/lib/format";
import type { AuditEntry } from "@shared/types";

interface AuditLogPanelProps {
  workspaceId: string;
}

function formatAction(entry: AuditEntry): string {
  const d = entry.details ?? {};
  const name = (d["name"] as string | undefined) ?? (d["channelName"] as string | undefined) ?? "";
  switch (entry.action) {
    case "channel.created": return `created channel ${name ? `#${name}` : ""}`;
    case "channel.updated": return `updated channel ${name ? `#${name}` : ""}`;
    case "channel.deleted": return `deleted channel ${name ? `#${name}` : ""}`;
    case "category.created": return `created category${name ? ` "${name}"` : ""}`;
    case "category.updated": return `updated category${name ? ` "${name}"` : ""}`;
    case "category.deleted": return `deleted category${name ? ` "${name}"` : ""}`;
    case "role.created": return `created role${name ? ` "${name}"` : ""}`;
    case "role.updated": return `updated role${name ? ` "${name}"` : ""}`;
    case "role.deleted": return `deleted role${name ? ` "${name}"` : ""}`;
    case "member.kicked": return `kicked a member`;
    case "member.banned": return `banned a member`;
    case "member.unbanned": return `unbanned a member`;
    case "member.updated": return `updated a member`;
    case "member.roles_updated": return `updated member roles`;
    case "workspace.updated": return `updated workspace settings`;
    case "invite.created": return `created an invite`;
    case "invite.revoked": return `revoked an invite`;
    default: return entry.action.replace(/\./g, " ");
  }
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const [expanded, setExpanded] = useState(false);
  const actor = entry.actor;

  return (
    <div className="border-b border-border last:border-0">
      <div
        className="flex items-center gap-3 px-3 py-2 hover:bg-muted/20 cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {actor ? (
          <UserAvatar
            user={{ id: actor.id, displayName: actor.displayName, avatarUrl: actor.avatarUrl }}
            size="sm"
          />
        ) : (
          <span className="size-6 rounded-full bg-muted shrink-0" aria-hidden />
        )}
        <div className="flex-1 min-w-0">
          <span className="font-medium text-sm">{actor?.displayName ?? "Unknown"}</span>
          <span className="text-sm text-muted-foreground ml-1.5">{formatAction(entry)}</span>
        </div>
        <span className="text-xs text-muted-foreground whitespace-nowrap">{formatFull(entry.createdAt)}</span>
        {entry.details && Object.keys(entry.details).length > 0 ? (
          <span className="text-muted-foreground" aria-hidden>
            {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </span>
        ) : null}
      </div>
      {expanded && entry.details && Object.keys(entry.details).length > 0 && (
        <div className="px-12 pb-2">
          <pre className="rounded-md bg-muted/30 px-3 py-2 text-xs overflow-x-auto whitespace-pre-wrap break-all">
            {JSON.stringify(entry.details, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

export function AuditLogPanel({ workspaceId }: AuditLogPanelProps) {
  const { data: entries = [], isLoading } = useAuditLog(workspaceId);

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading audit log…</p>;
  }

  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No audit log entries yet.</p>;
  }

  return (
    <div className="rounded-md border border-border overflow-hidden">
      {entries.map((entry) => (
        <AuditRow key={entry.id} entry={entry} />
      ))}
    </div>
  );
}
