import { useState } from "react";
import { NavLink, useParams } from "react-router";
import { Compass, Plus } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMe, useWorkspaces } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { WorkspaceIcon } from "./WorkspaceIcon";
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog";
import { JoinWorkspaceDialog } from "./JoinWorkspaceDialog";
import { Skeleton } from "@/components/ui/skeleton";

export function WorkspaceRail() {
  const workspaces = useWorkspaces();
  const { workspaceId } = useParams();
  const [createOpen, setCreateOpen] = useState(false);
  const canCreate = useMe().data?.canCreateWorkspace ?? false;
  const [joinOpen, setJoinOpen] = useState(false);

  return (
    <nav aria-label="Workspaces" className="flex w-16 shrink-0 flex-col items-center gap-2 border-r border-sidebar-border bg-rail py-2">
      <ul className="flex flex-1 flex-col items-center gap-2 overflow-y-auto px-2">
        {workspaces.isPending
          ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="size-12 rounded-2xl" />)
          : workspaces.data?.map((ws) => {
              const active = ws.id === workspaceId;
              return (
                <li key={ws.id} className="relative">
                  <span
                    aria-hidden
                    className={cn(
                      "absolute -left-2 top-1/2 h-2 w-1 -translate-y-1/2 rounded-r-full bg-foreground transition-all",
                      active ? "h-9 opacity-100" : "opacity-0 group-hover:h-5 group-hover:opacity-100",
                    )}
                  />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <NavLink
                        to={`/w/${ws.id}`}
                        aria-label={ws.name}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "group block rounded-2xl outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring",
                          active ? "rounded-xl" : "hover:rounded-xl",
                        )}
                      >
                        <WorkspaceIcon workspace={ws} size="lg" className={cn("transition-all", active ? "rounded-xl" : "group-hover:rounded-xl")} />
                      </NavLink>
                    </TooltipTrigger>
                    <TooltipContent side="right">{ws.name}</TooltipContent>
                  </Tooltip>
                </li>
              );
            })}
        <li className="my-1 h-px w-8 bg-sidebar-border" aria-hidden />
        {canCreate ? (
          <li>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setCreateOpen(true)}
                  aria-label="Create a workspace"
                  className="flex size-12 items-center justify-center rounded-2xl bg-sidebar text-success transition-all hover:rounded-xl hover:bg-success hover:text-white focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <Plus className="size-5" aria-hidden />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Create a workspace</TooltipContent>
            </Tooltip>
          </li>
        ) : null}
        <li>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setJoinOpen(true)}
                aria-label="Join a workspace with an invite"
                className="flex size-12 items-center justify-center rounded-2xl bg-sidebar text-success transition-all hover:rounded-xl hover:bg-success hover:text-white focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <Compass className="size-5" aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Join with an invite</TooltipContent>
          </Tooltip>
        </li>
      </ul>
      <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
      <JoinWorkspaceDialog open={joinOpen} onOpenChange={setJoinOpen} />
    </nav>
  );
}
