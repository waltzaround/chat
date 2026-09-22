import { useMemo } from "react";
import { useMembers, useWorkspace } from "@/lib/queries";
import { usePresenceMap } from "@/realtime/hooks";
import { memberDisplayName, roleColour } from "@/lib/permissions";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/common/UserAvatar";
import { MemberPopover } from "./MemberPopover";
import type { Member, PresenceStatus } from "@shared/types";
import { cn } from "@/lib/utils";

export function MemberList({ workspaceId }: { workspaceId: string }) {
  const members = useMembers(workspaceId);
  const workspace = useWorkspace(workspaceId);
  const presence = usePresenceMap();

  const groups = useMemo(() => {
    const list = members.data ?? [];
    const roles = workspace.data?.roles ?? [];
    const byName = (a: Member, b: Member) => memberDisplayName(a).localeCompare(memberDisplayName(b));
    const online = list.filter((m) => (presence[m.userId] ?? "offline") !== "offline").sort(byName);
    const offline = list.filter((m) => (presence[m.userId] ?? "offline") === "offline").sort(byName);
    return { online, offline, roles };
  }, [members.data, workspace.data?.roles, presence]);

  return (
    <aside aria-label="Members" className="flex w-60 shrink-0 flex-col border-l border-sidebar-border bg-sidebar">
      <div className="h-12 shrink-0 border-b border-sidebar-border" aria-hidden />
      <div className="flex-1 overflow-y-auto px-2 py-3">
        {members.isPending ? (
          <div className="space-y-2 px-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2">
                <Skeleton className="size-8 rounded-full" />
                <Skeleton className="h-3.5 w-24" />
              </div>
            ))}
          </div>
        ) : (
          <>
            <Group title={`Online — ${groups.online.length}`} members={groups.online} presence={presence} roles={groups.roles} workspaceId={workspaceId} />
            <Group title={`Offline — ${groups.offline.length}`} members={groups.offline} presence={presence} roles={groups.roles} workspaceId={workspaceId} dim />
          </>
        )}
      </div>
    </aside>
  );
}

function Group({ title, members, presence, roles, workspaceId, dim }: { title: string; members: Member[]; presence: Record<string, PresenceStatus>; roles: { id: string; colour: string | null; position: number }[]; workspaceId: string; dim?: boolean }) {
  if (members.length === 0) return null;
  return (
    <section className="mb-4" aria-label={title}>
      <h3 className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <ul className="space-y-px">
        {members.map((m) => {
          const colour = roleColour(m.roleIds, roles as never);
          return (
            <li key={m.userId}>
              <MemberPopover member={m} workspaceId={workspaceId}>
                <button
                  type="button"
                  className={cn("flex h-10 w-full items-center gap-2.5 rounded-md px-2 text-left transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", dim && "opacity-50 hover:opacity-100")}
                >
                  <UserAvatar user={m} size="md" status={presence[m.userId] ?? "offline"} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium" style={colour ? { color: colour } : undefined}>
                    {memberDisplayName(m)}
                  </span>
                </button>
              </MemberPopover>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
