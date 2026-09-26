import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, MessagesSquare, X } from "lucide-react";
import { useMe, useMessage, useMessageHistory, useThread } from "@/lib/queries";
import { usePendingMessages } from "@/realtime/hooks";
import { Permission, hasPermission } from "@/lib/permissions";
import { MessageItem, PendingMessageItem } from "./MessageItem";
import { MessageComposer } from "./MessageComposer";
import type { Channel, Message, WorkspaceDetail } from "@shared/types";

const GROUP_WINDOW_MS = 5 * 60 * 1000;

/** Side panel for one thread: its root, the replies, and a composer that posts into it. */
export function ThreadPanel({ channel, workspace, rootId, onClose }: { channel: Channel; workspace: WorkspaceDetail; rootId: string; onClose: () => void }) {
  const me = useMe().data;
  const history = useMessageHistory(channel.id);
  const cachedRoot = useMemo(() => history.data?.pages.flatMap((p) => p.messages).find((m) => m.id === rootId), [history.data, rootId]);
  // The root may not be loaded (opened from a notification or link): fetch it on its own.
  const fetchedRoot = useMessage(channel.id, rootId, cachedRoot);
  const root = cachedRoot ?? fetchedRoot.data;
  const thread = useThread(channel.id, rootId);
  const pending = usePendingMessages(channel.id).filter((p) => p.threadRootId === rootId);
  const [editing, setEditing] = useState<Message | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const replies = thread.data?.messages ?? [];
  const canSend = hasPermission(channel.permissions, Permission.SEND_MESSAGES);

  // Follow new replies.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [replies.length, pending.length]);

  return (
    // Beside the channel on wide screens; over it when there isn't room for both.
    <aside className="flex w-[380px] shrink-0 flex-col border-l bg-background max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-20 max-lg:w-full max-lg:max-w-md max-lg:shadow-xl" aria-label="Thread">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <MessagesSquare className="size-4 text-muted-foreground" aria-hidden />
        <h2 className="text-sm font-semibold">Thread</h2>
        <span className="truncate text-xs text-muted-foreground">{workspace.kind === "dm" ? workspace.dmPeer?.displayName : `#${channel.name}`}</span>
        <button type="button" onClick={onClose} aria-label="Close thread" className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
          <X className="size-4" aria-hidden />
        </button>
      </header>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto py-2" role="log" aria-live="polite" aria-label="Thread replies">
        {!root ? (
          fetchedRoot.isError ? (
            <p className="p-6 text-center text-sm text-muted-foreground">This message was deleted, or you can't see it.</p>
          ) : (
            <Loader2 className="mx-auto mt-6 size-5 animate-spin text-muted-foreground" aria-label="Loading thread" />
          )
        ) : (
          <>
            <MessageItem message={root} compact={false} channel={channel} workspace={workspace} isMine={root.author.id === me?.id} onReply={() => undefined} onEdit={setEditing} isEditing={editing?.id === root.id} inThread />
            <div className="mx-4 my-2 flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">
              <span>{replies.length} {replies.length === 1 ? "reply" : "replies"}</span>
              <span className="h-px flex-1 bg-border" />
            </div>
            {thread.isPending ? <Loader2 className="mx-auto size-4 animate-spin text-muted-foreground" aria-label="Loading replies" /> : null}
            {thread.data?.hasMore ? <p className="px-4 pb-2 text-xs text-muted-foreground">Showing the latest 100 replies.</p> : null}
            {replies.map((m, i) => {
              const prev = replies[i - 1];
              const compact = !!prev && prev.author.id === m.author.id && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_WINDOW_MS;
              return <MessageItem key={m.id} message={m} compact={compact} channel={channel} workspace={workspace} isMine={m.author.id === me?.id} onReply={() => undefined} onEdit={setEditing} isEditing={editing?.id === m.id} inThread />;
            })}
            {me ? pending.map((p) => <PendingMessageItem key={p.clientMessageId} pending={p} compact={false} me={me} />) : null}
          </>
        )}
      </div>
      <div className="shrink-0 px-3 pb-3">
        <MessageComposer
          channel={channel}
          reply={null}
          onClearReply={() => undefined}
          editing={editing}
          onDoneEditing={() => setEditing(null)}
          disabled={!canSend || !root}
          threadRootId={rootId}
          placeholderText="Reply in thread…"
        />
      </div>
    </aside>
  );
}
