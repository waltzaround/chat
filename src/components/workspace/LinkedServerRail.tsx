import { AlertTriangle } from "lucide-react";
import { MentionBadge } from "@/components/common/MentionBadge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { hueFor, initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { LinkRevokedError, openOnServer, useLinkedImage, useLinkedServers, useLinkedSummaries, type LinkedServer } from "@/lib/linked-servers";
import type { DirectMessage, WorkspaceSummary } from "@shared/types";

/** Workspaces on your other servers, one group per server, below this server's own. */
export function LinkedServerRail() {
  const servers = useLinkedServers().data ?? [];
  const summaries = useLinkedSummaries(servers);
  if (servers.length === 0) return null;
  return (
    <>
      {servers.map((server, i) => {
        const q = summaries[i];
        const host = new URL(server.origin).host;
        return (
          <li key={server.origin} className="flex w-full flex-col items-center gap-2" aria-label={`Workspaces on ${host}`}>
            <span className="h-px w-8 bg-sidebar-border" aria-hidden />
            {q?.error ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => openOnServer(server.origin, "/")}
                    aria-label={`${host}: ${q.error instanceof LinkRevokedError ? "signed out" : "can't be reached"}`}
                    className="flex size-12 items-center justify-center rounded-2xl bg-sidebar text-warning transition-all hover:rounded-xl"
                  >
                    <AlertTriangle className="size-5" aria-hidden />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {q.error instanceof LinkRevokedError ? `Signed out of ${host}. Unlink it in Settings and link it again.` : `Can't reach ${host} right now.`}
                </TooltipContent>
              </Tooltip>
            ) : null}
            {q?.data?.dms
              .filter((dm) => dm.unreadCount > 0)
              .map((dm) => <LinkedDm key={dm.workspaceId} server={server} dm={dm} host={host} />)}
            {q?.data?.workspaces.map((ws) => <LinkedWorkspace key={ws.id} server={server} workspace={ws} host={host} />)}
          </li>
        );
      })}
    </>
  );
}

const tile = "relative block size-12 rounded-2xl outline-none transition-all hover:rounded-xl focus-visible:ring-2 focus-visible:ring-ring";

function LinkedWorkspace({ server, workspace, host }: { server: LinkedServer; workspace: WorkspaceSummary; host: string }) {
  const icon = useLinkedImage(server, workspace.iconUrl);
  const label = `${workspace.name} on ${host}${workspace.mentionCount ? ` · ${workspace.mentionCount} ${workspace.mentionCount === 1 ? "mention" : "mentions"}` : ""}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" onClick={() => openOnServer(server.origin, `/w/${workspace.id}`)} aria-label={label} className={cn(tile, "group")}>
          {icon ? (
            <img src={icon} alt="" className="size-12 rounded-[inherit] object-cover" />
          ) : (
            <span className="flex size-12 items-center justify-center rounded-[inherit] text-base font-semibold text-white" style={{ background: `oklch(0.5 0.12 ${hueFor(workspace.id)})` }} aria-hidden>
              {initials(workspace.name)}
            </span>
          )}
          <MentionBadge count={workspace.mentionCount} className="absolute -right-1 -bottom-1 ring-2 ring-rail" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function LinkedDm({ server, dm, host }: { server: LinkedServer; dm: DirectMessage; host: string }) {
  const avatar = useLinkedImage(server, dm.peer.avatarUrl);
  const label = `${dm.peer.displayName} on ${host} · ${dm.unreadCount} unread`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" onClick={() => openOnServer(server.origin, `/w/${dm.workspaceId}/c/${dm.channelId}`)} aria-label={label} className={cn(tile, "rounded-full hover:rounded-2xl")}>
          {avatar ? (
            <img src={avatar} alt="" className="size-12 rounded-[inherit] object-cover" />
          ) : (
            <span className="flex size-12 items-center justify-center rounded-[inherit] text-base font-semibold text-white" style={{ background: `oklch(0.55 0.12 ${hueFor(dm.peer.id)})` }} aria-hidden>
              {initials(dm.peer.displayName)}
            </span>
          )}
          <MentionBadge count={dm.unreadCount} noun="message" className="absolute -right-1 -bottom-1 ring-2 ring-rail" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
