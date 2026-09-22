import { useState } from "react";
import { Hash, Link2, MicOff, Monitor, Pencil, Settings2, Trash2, Video, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { UserAvatar } from "@/components/common/UserAvatar";
import { useVoiceParticipants } from "@/realtime/hooks";
import { useRealtime } from "@/realtime/RealtimeProvider";
import { useDeleteChannel } from "@/lib/queries";
import { memberDisplayName, roleColour } from "@/lib/permissions";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Channel, Member, Role } from "@shared/types";
import { EditChannelDialog } from "./EditChannelDialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function ChannelItem({
  channel,
  active,
  canManage,
  workspaceId,
  membersById,
  roles,
  onClick,
}: {
  channel: Channel;
  active: boolean;
  canManage: boolean;
  workspaceId: string;
  membersById: Map<string, Member>;
  roles: Role[];
  onClick: () => void;
}) {
  const participants = useVoiceParticipants(channel.id);
  const rt = useRealtime();
  const remove = useDeleteChannel(workspaceId);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const unread = channel.kind === "text" && !active && channel.lastSequence > channel.lastReadSequence;
  const Icon = channel.kind === "voice" ? Volume2 : Hash;

  const markRead = () => rt.markRead(channel.id, channel.lastSequence);
  const copyLink = async () => {
    await navigator.clipboard.writeText(`${window.location.origin}/w/${workspaceId}/c/${channel.id}`);
    toast.success("Link copied");
  };
  const confirmDelete = async () => {
    try {
      await remove.mutateAsync(channel.id);
      toast.success(`Deleted ${channel.kind === "text" ? "#" : ""}${channel.name}`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <li>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            onClick={onClick}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-left text-[0.92rem] transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
              unread && "font-semibold text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{channel.name}</span>
            {unread ? <span className="size-2 rounded-full bg-foreground" aria-label="Unread messages" /> : null}
            {canManage ? (
              <span
                role="button"
                tabIndex={-1}
                aria-label={`Edit ${channel.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setEditOpen(true);
                }}
                className="hidden rounded p-0.5 text-muted-foreground hover:text-foreground group-hover:inline-flex"
              >
                <Settings2 className="size-3.5" aria-hidden />
              </span>
            ) : null}
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-48">
          {channel.kind === "text" ? (
            <ContextMenuItem onSelect={markRead} disabled={!unread}>
              Mark as read
            </ContextMenuItem>
          ) : null}
          <ContextMenuItem onSelect={() => void copyLink()}>
            <Link2 /> Copy link
          </ContextMenuItem>
          {canManage ? (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => setEditOpen(true)}>
                <Pencil /> Edit channel
              </ContextMenuItem>
              <ContextMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
                <Trash2 /> Delete channel
              </ContextMenuItem>
            </>
          ) : null}
        </ContextMenuContent>
      </ContextMenu>

      {channel.kind === "voice" && participants.length > 0 ? (
        <ul className="mt-px mb-1 space-y-px pl-6" aria-label={`People in ${channel.name}`}>
          {participants.map((p) => {
            const m = membersById.get(p.userId);
            const name = m ? memberDisplayName(m) : "Unknown";
            return (
              <li key={p.userId} className="flex h-6 items-center gap-1.5 rounded px-1 text-xs text-sidebar-foreground">
                <UserAvatar user={{ id: p.userId, displayName: name, avatarUrl: m?.avatarUrl ?? null }} size="xs" />
                <span className="min-w-0 flex-1 truncate" style={{ color: m ? roleColour(m.roleIds, roles) ?? undefined : undefined }}>
                  {name}
                </span>
                {p.screen ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Monitor className="size-3 text-success" aria-label="Sharing screen" />
                    </TooltipTrigger>
                    <TooltipContent>Sharing screen</TooltipContent>
                  </Tooltip>
                ) : null}
                {p.video ? <Video className="size-3 text-muted-foreground" aria-label="Camera on" /> : null}
                {p.muted || p.deafened ? <MicOff className="size-3 text-muted-foreground" aria-label="Muted" /> : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {canManage ? <EditChannelDialog workspaceId={workspaceId} channel={channel} open={editOpen} onOpenChange={setEditOpen} /> : null}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {channel.kind === "text" ? `#${channel.name}` : channel.name}?</AlertDialogTitle>
            <AlertDialogDescription>All messages and attachments in this channel will be permanently removed. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => void confirmDelete()}>
              Delete channel
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}
