import { memo, useMemo, useState } from "react";
import { AlertCircle, CornerUpLeft, Flag, Loader2, MoreHorizontal, Pencil, Reply, SmilePlus, Trash2, Copy, Link2 } from "lucide-react";
import { toast } from "sonner";
import { useRealtime } from "@/realtime/RealtimeProvider";
import type { PendingMessage } from "@/realtime/RealtimeProvider";
import { Permission, hasPermission } from "@/lib/permissions";
import { useBlockedIds, useEmojiMap, useEmojis, useMe, useMembers } from "@/lib/queries";
import { mentionsUser, type MentionContext } from "@/lib/mentions";
import { formatFull, formatMessageTimestamp, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/common/UserAvatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Markdown } from "./Markdown";
import { ReactionBar } from "./ReactionBar";
import { EmojiPicker } from "./EmojiPicker";
import { AttachmentView } from "./AttachmentView";
import { ReportMessageDialog } from "./ReportMessageDialog";
import type { Channel, CurrentUser, Message, WorkspaceDetail } from "@shared/types";

export const MessageItem = memo(function MessageItem({
  message,
  compact,
  channel,
  workspace,
  isMine,
  onReply,
  onEdit,
  isEditing,
}: {
  message: Message;
  compact: boolean;
  channel: Channel;
  workspace: WorkspaceDetail;
  isMine: boolean;
  onReply: (m: Message) => void;
  onEdit: (m: Message) => void;
  isEditing: boolean;
}) {
  const rt = useRealtime();
  const emojis = useEmojiMap(workspace.id);
  const customEmojis = useEmojis(workspace.id).data ?? [];
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const canReact = hasPermission(channel.permissions, Permission.ADD_REACTIONS);
  const canDelete = isMine || hasPermission(channel.permissions, Permission.MANAGE_MESSAGES);
  const name = message.author.nickname ?? message.author.displayName;
  const me = useMe().data;
  const members = useMembers(workspace.id).data;
  const mentionCtx = useMemo<MentionContext | undefined>(
    () => (me ? { me: me.username.toLowerCase(), known: new Set((members ?? []).map((m) => m.username.toLowerCase())) } : undefined),
    [me, members],
  );
  const blocked = useBlockedIds();
  const [revealed, setRevealed] = useState(false);
  // Highlight messages that call for your attention, like other chat apps do.
  const mentionsMe = !isMine && !!me && (mentionsUser(message.content, me.username) || message.replyTo?.author?.id === me.id);

  const react = (emoji: string) => {
    const existing = message.reactions.find((r) => r.emoji === emoji);
    rt.send(existing?.me ? { type: "reaction.remove", messageId: message.id, emoji } : { type: "reaction.add", messageId: message.id, emoji });
    setEmojiOpen(false);
  };
  const copyText = async () => {
    await navigator.clipboard.writeText(message.content);
    toast.success("Copied message text");
  };
  const copyLink = async () => {
    await navigator.clipboard.writeText(`${window.location.origin}/w/${workspace.id}/c/${channel.id}?m=${message.sequence}`);
    toast.success("Link copied");
  };

  if (blocked.has(message.author.id) && !revealed) {
    return (
      <div className={cn("px-4 py-1 text-xs text-muted-foreground", !compact && "mt-3")} id={`m-${message.sequence}`}>
        Message from someone you blocked.{" "}
        <button type="button" className="text-primary hover:underline" onClick={() => setRevealed(true)}>
          Show message
        </button>
      </div>
    );
  }

  return (
    <article
      className={cn(
        "group relative px-4 py-0.5 hover:bg-accent/40",
        !compact && "mt-3",
        mentionsMe && "border-l-2 border-warning bg-warning/10 pl-[14px] hover:bg-warning/15",
        isEditing && "bg-accent/60",
      )}
      aria-label={`${name} at ${formatFull(message.createdAt)}`}
      id={`m-${message.sequence}`}
    >
      {message.replyTo ? (
        <div className="mb-0.5 ml-[52px] flex items-center gap-1.5 text-xs text-muted-foreground">
          <CornerUpLeft className="size-3.5 shrink-0" aria-hidden />
          {message.replyTo.deleted || !message.replyTo.author ? (
            <span className="italic">Original message was deleted</span>
          ) : (
            <>
              <UserAvatar user={message.replyTo.author} size="xs" />
              <span className="font-medium text-foreground/80">{message.replyTo.author.displayName}</span>
              <a href={`#m-${message.replyTo.id}`} className="min-w-0 truncate hover:text-foreground" onClick={(e) => e.preventDefault()}>
                {message.replyTo.content.slice(0, 140) || "Attachment"}
              </a>
            </>
          )}
        </div>
      ) : null}
      <div className="flex gap-3">
        <div className="w-10 shrink-0">
          {compact ? (
            <span className="block pt-1 text-right text-[10px] leading-5 text-muted-foreground opacity-0 group-hover:opacity-100" aria-hidden>
              {formatTime(message.createdAt)}
            </span>
          ) : (
            <UserAvatar user={{ ...message.author, displayName: name }} size="lg" className="mt-0.5" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          {!compact ? (
            <div className="flex items-baseline gap-2">
              <span className="text-[0.95rem] font-semibold" style={message.author.roleColour ? { color: message.author.roleColour } : undefined}>
                {name}
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <time dateTime={message.createdAt} className="text-[11px] text-muted-foreground">
                    {formatMessageTimestamp(message.createdAt)}
                  </time>
                </TooltipTrigger>
                <TooltipContent>{formatFull(message.createdAt)}</TooltipContent>
              </Tooltip>
            </div>
          ) : null}
          {message.content ? (
            <div className={cn("message-body", message.editedAt && "edited")}>
              <Markdown content={message.content} emojis={emojis} mentions={mentionCtx} />
              {message.editedAt ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="ml-1 text-[10px] text-muted-foreground">(edited)</span>
                  </TooltipTrigger>
                  <TooltipContent>Edited {formatFull(message.editedAt)}</TooltipContent>
                </Tooltip>
              ) : null}
            </div>
          ) : null}
          {message.attachments.length ? (
            <div className="mt-1 flex flex-wrap gap-2">
              {message.attachments.map((a) => (
                <AttachmentView key={a.id} attachment={a} />
              ))}
            </div>
          ) : null}
          {message.reactions.length ? <ReactionBar reactions={message.reactions} onToggle={react} canReact={canReact} onAdd={canReact ? () => setEmojiOpen(true) : undefined} emojis={emojis} /> : null}
        </div>
      </div>

      {/* Hover toolbar */}
      <div
        className={cn(
          "absolute -top-3 right-4 hidden items-center rounded-md border bg-popover shadow-sm group-hover:flex group-focus-within:flex",
          emojiOpen && "flex",
        )}
        role="toolbar"
        aria-label="Message actions"
      >
        {canReact ? (
          <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
            <PopoverTrigger asChild>
              <ToolbarButton label="Add reaction">
                <SmilePlus className="size-4" aria-hidden />
              </ToolbarButton>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-auto p-0">
              <EmojiPicker onPick={react} customEmojis={customEmojis} />
            </PopoverContent>
          </Popover>
        ) : null}
        <ToolbarButton label="Reply" onClick={() => onReply(message)}>
          <Reply className="size-4" aria-hidden />
        </ToolbarButton>
        {isMine ? (
          <ToolbarButton label="Edit message" onClick={() => onEdit(message)}>
            <Pencil className="size-4" aria-hidden />
          </ToolbarButton>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <ToolbarButton label="More actions">
              <MoreHorizontal className="size-4" aria-hidden />
            </ToolbarButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onSelect={() => onReply(message)}>
              <Reply /> Reply
            </DropdownMenuItem>
            {isMine ? (
              <DropdownMenuItem onSelect={() => onEdit(message)}>
                <Pencil /> Edit
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onSelect={() => void copyText()}>
              <Copy /> Copy text
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void copyLink()}>
              <Link2 /> Copy link
            </DropdownMenuItem>
            {isMine ? null : (
              <DropdownMenuItem onSelect={() => setReportOpen(true)}>
                <Flag /> Report
              </DropdownMenuItem>
            )}
            {canDelete ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
                  <Trash2 /> Delete
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {isMine ? null : <ReportMessageDialog message={message} channelId={channel.id} open={reportOpen} onOpenChange={setReportOpen} />}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete message?</AlertDialogTitle>
            <AlertDialogDescription>{isMine ? "This message will be removed for everyone." : `This will remove ${name}'s message for everyone and be recorded in the audit log.`}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="max-h-40 overflow-y-auto rounded-md border bg-muted/40 p-3 text-sm">
            <Markdown content={message.content || "(attachment)"} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => rt.send({ type: "message.delete", messageId: message.id })}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
});

function ToolbarButton({ label, onClick, children, ...rest }: { label: string; onClick?: () => void; children: React.ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          {...rest}
          className="flex size-7 items-center justify-center text-muted-foreground transition-colors first:rounded-l-md last:rounded-r-md hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function PendingMessageItem({ pending, compact, me }: { pending: PendingMessage; compact: boolean; me: CurrentUser }) {
  const rt = useRealtime();
  const emojis = useEmojiMap(rt.workspaceId);
  const failed = pending.status === "failed";
  return (
    <article className={cn("group relative px-4 py-0.5", !compact && "mt-3")} aria-label={failed ? "Message failed to send" : "Sending message"} aria-busy={!failed}>
      {pending.replyTo?.author ? (
        <div className="mb-0.5 ml-[52px] flex items-center gap-1.5 text-xs text-muted-foreground">
          <CornerUpLeft className="size-3.5" aria-hidden />
          <span className="font-medium">{pending.replyTo.author.displayName}</span>
          <span className="truncate">{pending.replyTo.content.slice(0, 140)}</span>
        </div>
      ) : null}
      <div className="flex gap-3">
        <div className="w-10 shrink-0">{compact ? null : <UserAvatar user={me} size="lg" className="mt-0.5" />}</div>
        <div className={cn("min-w-0 flex-1", !failed && "opacity-60")}>
          {!compact ? (
            <div className="flex items-baseline gap-2">
              <span className="text-[0.95rem] font-semibold">{me.displayName}</span>
              <span className="text-[11px] text-muted-foreground">{formatMessageTimestamp(pending.createdAt)}</span>
            </div>
          ) : null}
          {pending.content ? (
            <div className="message-body">
              <Markdown content={pending.content} emojis={emojis} />
            </div>
          ) : null}
          {pending.attachments.length ? (
            <div className="mt-1 flex flex-wrap gap-2">
              {pending.attachments.map((a) => (
                <AttachmentView key={a.id} attachment={a} />
              ))}
            </div>
          ) : null}
          <div className="mt-0.5 flex items-center gap-2 text-[11px]">
            {failed ? (
              <>
                <AlertCircle className="size-3.5 text-destructive" aria-hidden />
                <span className="text-destructive">{pending.error ?? "Failed to send"}.</span>
                <button type="button" className="font-medium text-primary hover:underline" onClick={() => rt.retryMessage(pending.clientMessageId)}>
                  Retry
                </button>
                <button type="button" className="text-muted-foreground hover:underline" onClick={() => rt.discardMessage(pending.clientMessageId)}>
                  Discard
                </button>
              </>
            ) : (
              <>
                <Loader2 className="size-3 animate-spin text-muted-foreground" aria-hidden />
                <span className="text-muted-foreground">Sending…</span>
              </>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
