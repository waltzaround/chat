import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ChevronDown, ChevronRight, FolderPlus, Hash, LogOut, Plus, Settings, UserPlus, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace, useMembers, useMemberMutations } from "@/lib/queries";
import { Permission, can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { ChannelItem } from "./ChannelItem";
import { CreateChannelDialog } from "./CreateChannelDialog";
import { CreateCategoryDialog } from "./CreateCategoryDialog";
import { InviteDialog } from "@/components/workspace/InviteDialog";
import { UserPanel } from "./UserPanel";
import type { Category, Channel } from "@shared/types";
import { errorMessage } from "@/lib/api";
import { useVoice } from "@/components/voice/VoiceProvider";

export function ChannelSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { workspaceId, channelId } = useParams();
  const navigate = useNavigate();
  const workspace = useWorkspace(workspaceId);
  const members = useMembers(workspaceId);
  const memberActions = useMemberMutations(workspaceId ?? "");
  const voice = useVoice();
  const [collapsed, setCollapsed] = useLocalStorage<Record<string, boolean>>(`chat.collapsed.${workspaceId}`, {});
  const [createChannel, setCreateChannel] = useState<{ open: boolean; categoryId: string | null; kind: "text" | "voice" }>({ open: false, categoryId: null, kind: "text" });
  const [createCategory, setCreateCategory] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  const ws = workspace.data;
  const canManage = can(ws, Permission.MANAGE_CHANNELS);
  const canInvite = can(ws, Permission.CREATE_INVITES);
  const canSettings = can(ws, Permission.MANAGE_WORKSPACE) || can(ws, Permission.MANAGE_ROLES) || can(ws, Permission.MANAGE_CHANNELS) || can(ws, Permission.BAN_MEMBERS);

  const grouped = useMemo(() => {
    if (!ws) return [];
    const byCategory = new Map<string | null, Channel[]>();
    for (const ch of ws.channels) {
      const key = ws.categories.some((c) => c.id === ch.categoryId) ? ch.categoryId : null;
      byCategory.set(key, [...(byCategory.get(key) ?? []), ch]);
    }
    const sortCh = (list: Channel[]) => [...list].sort((a, b) => (a.kind === b.kind ? a.position - b.position : a.kind === "text" ? -1 : 1));
    const groups: { category: Category | null; channels: Channel[] }[] = [];
    if (byCategory.has(null)) groups.push({ category: null, channels: sortCh(byCategory.get(null)!) });
    for (const cat of [...ws.categories].sort((a, b) => a.position - b.position)) {
      groups.push({ category: cat, channels: sortCh(byCategory.get(cat.id) ?? []) });
    }
    return groups;
  }, [ws]);

  const membersById = useMemo(() => new Map((members.data ?? []).map((m) => [m.userId, m])), [members.data]);

  const onChannelClick = (ch: Channel) => {
    if (ch.kind === "voice") {
      if (voice.connectedChannelId !== ch.id) void voice.join(ch.id);
    }
    navigate(`/w/${workspaceId}/c/${ch.id}`);
    onNavigate?.();
  };

  const leave = async () => {
    if (!ws) return;
    if (!confirm(`Leave ${ws.name}?`)) return;
    try {
      await memberActions.leave.mutateAsync();
      navigate("/");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <aside aria-label="Channels" className="flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-12 w-full items-center justify-between border-b border-sidebar-border px-4 text-left font-semibold text-foreground transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
            aria-label={ws ? `${ws.name} — workspace menu` : "Workspace menu"}
          >
            {ws ? <span className="truncate">{ws.name}</span> : <Skeleton className="h-4 w-28" />}
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {canInvite ? (
            <DropdownMenuItem onSelect={() => setInviteOpen(true)}>
              <UserPlus /> Invite people
            </DropdownMenuItem>
          ) : null}
          {canSettings ? (
            <DropdownMenuItem onSelect={() => navigate(`/w/${workspaceId}/settings`)}>
              <Settings /> Workspace settings
            </DropdownMenuItem>
          ) : null}
          {canManage ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setCreateChannel({ open: true, categoryId: null, kind: "text" })}>
                <Plus /> Create channel
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setCreateCategory(true)}>
                <FolderPlus /> Create category
              </DropdownMenuItem>
            </>
          ) : null}
          {ws && ws.ownerUserId !== members.data?.find((m) => m.isOwner)?.userId ? null : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={leave} disabled={!ws}>
            <LogOut /> Leave workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <nav className="flex-1 overflow-y-auto px-2 py-2" aria-label="Channel list">
        {workspace.isPending ? (
          <div className="space-y-2 px-2 pt-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        ) : (
          grouped.map(({ category, channels }) => {
            const isCollapsed = category ? !!collapsed[category.id] : false;
            return (
              <section key={category?.id ?? "uncategorised"} className="mb-3" aria-label={category?.name ?? "Channels"}>
                {category ? (
                  <div className="group flex items-center justify-between pt-2 pr-1">
                    <button
                      type="button"
                      onClick={() => setCollapsed((c) => ({ ...c, [category.id]: !c[category.id] }))}
                      aria-expanded={!isCollapsed}
                      className="flex min-w-0 flex-1 items-center gap-0.5 rounded px-1 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      {isCollapsed ? <ChevronRight className="size-3" aria-hidden /> : <ChevronDown className="size-3" aria-hidden />}
                      <span className="truncate">{category.name}</span>
                    </button>
                    {canManage ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            aria-label={`Create channel in ${category.name}`}
                            onClick={() => setCreateChannel({ open: true, categoryId: category.id, kind: "text" })}
                            className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                          >
                            <Plus className="size-3.5" aria-hidden />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Create channel</TooltipContent>
                      </Tooltip>
                    ) : null}
                  </div>
                ) : null}
                <ul className={cn("mt-0.5 space-y-px", isCollapsed && "hidden")}>
                  {channels.map((ch) => (
                    <ChannelItem
                      key={ch.id}
                      channel={ch}
                      active={ch.id === channelId}
                      canManage={canManage}
                      workspaceId={workspaceId!}
                      membersById={membersById}
                      roles={ws?.roles ?? []}
                      onClick={() => onChannelClick(ch)}
                    />
                  ))}
                  {isCollapsed
                    ? null
                    : channels.length === 0 && (
                        <li className="px-2 py-1 text-xs text-muted-foreground/70">{canManage ? "No channels yet" : ""}</li>
                      )}
                </ul>
              </section>
            );
          })
        )}
        {ws && ws.channels.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs text-muted-foreground">
            <Hash className="mx-auto mb-2 size-5 opacity-50" aria-hidden />
            {canManage ? "Create your first channel from the workspace menu." : "There are no channels you can see yet."}
          </div>
        ) : null}
      </nav>

      <UserPanel />

      {workspaceId ? (
        <>
          <CreateChannelDialog
            workspaceId={workspaceId}
            open={createChannel.open}
            categoryId={createChannel.categoryId}
            initialKind={createChannel.kind}
            categories={ws?.categories ?? []}
            onOpenChange={(open) => setCreateChannel((s) => ({ ...s, open }))}
          />
          <CreateCategoryDialog workspaceId={workspaceId} open={createCategory} onOpenChange={setCreateCategory} />
          {ws ? <InviteDialog workspace={ws} open={inviteOpen} onOpenChange={setInviteOpen} /> : null}
        </>
      ) : null}
      <span className="sr-only">
        <Volume2 aria-hidden />
      </span>
    </aside>
  );
}
