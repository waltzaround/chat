import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut, Settings } from "lucide-react";
import { useMe, useUpdateMe } from "@/lib/queries";
import { authClient } from "@/lib/auth-client";
import { useRealtimeOptional } from "@/realtime/RealtimeProvider";
import { usePresence } from "@/realtime/hooks";
import { UserAvatar } from "@/components/common/UserAvatar";
import { StatusDot, STATUS_LABEL } from "@/components/common/StatusDot";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { PreferredStatus } from "@shared/types";

const STATUSES: PreferredStatus[] = ["online", "idle", "dnd", "invisible"];

export function UserPanel() {
  const me = useMe();
  const update = useUpdateMe();
  const rt = useRealtimeOptional();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const presence = usePresence(me.data?.id ?? "");

  if (!me.data) return <div className="h-14 border-t border-sidebar-border" />;
  const user = me.data;
  const shown = user.status === "invisible" ? "offline" : presence === "offline" ? "offline" : user.status;

  const setStatus = (status: PreferredStatus) => {
    rt?.setPresence(status);
    update.mutate({ status });
  };

  const signOut = async () => {
    await authClient.signOut();
    qc.clear();
    navigate("/login", { replace: true });
  };

  return (
    <div className="flex h-14 items-center gap-2 border-t border-sidebar-border bg-rail/60 px-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            aria-label={`${user.displayName}, ${STATUS_LABEL[shown]}. Change status`}
          >
            <UserAvatar user={user} size="md" status={shown} />
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-sm font-medium text-foreground">{user.displayName}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{STATUS_LABEL[user.status]}</span>
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" className="w-56">
          <DropdownMenuLabel className="text-xs text-muted-foreground">@{user.username}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {STATUSES.map((s) => (
            <DropdownMenuItem key={s} onSelect={() => setStatus(s)} className="gap-2">
              <StatusDot status={s === "invisible" ? "offline" : s} />
              <span className="flex-1">{STATUS_LABEL[s]}</span>
              {user.status === s ? <span className="text-xs text-muted-foreground">Current</span> : null}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => navigate("/settings")}>
            <Settings /> User settings
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => void signOut()}>
            <LogOut /> Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => navigate("/settings")}
            aria-label="User settings"
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <Settings className="size-4" aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent>User settings</TooltipContent>
      </Tooltip>
    </div>
  );
}
