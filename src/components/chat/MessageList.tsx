import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, Hash, Loader2, MessageCircle } from "lucide-react";
import { useMe, useMessageHistory } from "@/lib/queries";
import { useRealtime } from "@/realtime/RealtimeProvider";
import { usePendingMessages, useSyncVersion } from "@/realtime/hooks";
import type { PendingMessage } from "@/realtime/RealtimeProvider";
import { formatDayDivider, formatTime, isSameDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MessageItem, PendingMessageItem } from "./MessageItem";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import type { Channel, Message, WorkspaceDetail } from "@shared/types";

type Row =
  | { kind: "divider"; key: string; label: string }
  | { kind: "message"; key: string; message: Message; compact: boolean }
  | { kind: "pending"; key: string; pending: PendingMessage; compact: boolean }
  | { kind: "top"; key: string }
  | { kind: "unread"; key: string };

const GROUP_WINDOW_MS = 5 * 60 * 1000;
const BOTTOM_THRESHOLD = 48;

export function MessageList({
  channel,
  workspace,
  onReply,
  onEdit,
  editingId,
}: {
  channel: Channel;
  workspace: WorkspaceDetail;
  onReply: (m: Message) => void;
  onEdit: (m: Message) => void;
  editingId: string | null;
}) {
  const history = useMessageHistory(channel.id);
  const pending = usePendingMessages(channel.id);
  const syncVersion = useSyncVersion();
  const me = useMe();
  const rt = useRealtime();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const initialScrolled = useRef(false);
  // What was unread when you opened the channel. The "New" line marks where that
  // starts; messages arriving while you watch don't move it.
  const [unread] = useState(() => ({ after: channel.lastReadSequence, through: channel.lastSequence }));
  const [unreadDismissed, setUnreadDismissed] = useState(false);
  const [jumping, setJumping] = useState(false);
  const prependState = useRef<{ total: number; offset: number } | null>(null);

  const messages = useMemo(() => {
    const pages = history.data?.pages ?? [];
    const out: Message[] = [];
    for (let i = pages.length - 1; i >= 0; i--) out.push(...pages[i]!.messages);
    out.sort((a, b) => a.sequence - b.sequence);
    return out;
  }, [history.data]);

  const rows = useMemo<Row[]>(() => {
    const rows: Row[] = [];
    if (history.hasNextPage) rows.push({ kind: "top", key: "top" });
    let prev: Message | null = null;
    let unreadPlaced = false;
    for (const m of messages) {
      if (!prev || !isSameDay(prev.createdAt, m.createdAt)) rows.push({ kind: "divider", key: `d-${m.id}`, label: formatDayDivider(m.createdAt) });
      if (!unreadPlaced && m.sequence > unread.after && m.sequence <= unread.through && m.author.id !== me.data?.id) {
        rows.push({ kind: "unread", key: "unread" });
        unreadPlaced = true;
      }
      const compact = !!prev && isSameDay(prev.createdAt, m.createdAt) && prev.author.id === m.author.id && !m.replyTo && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_WINDOW_MS;
      rows.push({ kind: "message", key: m.id, message: m, compact });
      prev = m;
    }
    for (const p of pending) {
      const compact = !!prev && prev.author.id === me.data?.id && !p.replyTo && Date.now() - new Date(prev.createdAt).getTime() < GROUP_WINDOW_MS;
      rows.push({ kind: "pending", key: p.clientMessageId, pending: p, compact });
    }
    return rows;
  }, [messages, pending, history.hasNextPage, me.data?.id, unread]);

  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (rows[i]?.kind === "divider" ? 36 : rows[i]?.kind === "top" ? 40 : rows[i]?.kind === "unread" ? 20 : rows[i]?.kind === "message" && !rows[i].compact ? 64 : 28),
    getItemKey: (i) => rows[i]?.key ?? i,
    overscan: 12,
  });
  // Keep what the user is looking at stable while older items above them get measured.
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) => item.start < (instance.scrollOffset ?? 0);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior });
      setUnseen(0);
    },
    [],
  );

  // Track whether the user is pinned to the bottom.
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const bottom = distance < BOTTOM_THRESHOLD;
    setAtBottom(bottom);
    if (bottom) setUnseen(0);
    if (el.scrollTop < 400 && history.hasNextPage && !history.isFetchingNextPage && initialScrolled.current) {
      prependState.current = { total: virtualizer.getTotalSize(), offset: el.scrollTop };
      void history.fetchNextPage();
    }
  }, [history, virtualizer]);

  // Initial scroll to bottom once the first page is in.
  useLayoutEffect(() => {
    if (initialScrolled.current || !history.data) return;
    initialScrolled.current = true;
    requestAnimationFrame(() => scrollToBottom());
  }, [history.data, scrollToBottom]);

  // Preserve position after prepending older history.
  useLayoutEffect(() => {
    const st = prependState.current;
    const el = scrollRef.current;
    if (!st || !el || history.isFetchingNextPage) return;
    prependState.current = null;
    const delta = virtualizer.getTotalSize() - st.total;
    if (delta > 0) el.scrollTop = st.offset + delta;
  }, [rows.length, history.isFetchingNextPage, virtualizer]);

  // New messages: stay anchored if at bottom, otherwise count them.
  const lastKey = rows.length ? rows[rows.length - 1]!.key : null;
  const prevLastKey = useRef<string | null>(null);
  const prevCount = useRef(0);
  useEffect(() => {
    if (!initialScrolled.current) return;
    if (lastKey !== prevLastKey.current && rows.length >= prevCount.current) {
      const last = rows[rows.length - 1];
      const mine = last?.kind === "pending" || (last?.kind === "message" && last.message.author.id === me.data?.id);
      if (atBottom || mine) requestAnimationFrame(() => scrollToBottom());
      else if (last?.kind === "message") setUnseen((n) => n + 1);
    }
    prevLastKey.current = lastKey;
    prevCount.current = rows.length;
  }, [lastKey, rows, atBottom, me.data?.id, scrollToBottom, syncVersion]);

  // Read state: when at the bottom and the tab is visible, mark the newest message read.
  const newest = messages.length ? messages[messages.length - 1]!.sequence : 0;
  useEffect(() => {
    if (!atBottom || newest === 0 || document.visibilityState !== "visible") return;
    rt.markRead(channel.id, newest);
  }, [atBottom, newest, channel.id, rt]);
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible" && atBottom && newest) rt.markRead(channel.id, newest);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [atBottom, newest, channel.id, rt]);

  // "N new messages" bar: shown while the New line is above the view (or not loaded yet).
  const unreadIndex = rows.findIndex((r) => r.kind === "unread");
  const firstUnread = messages.find((m) => m.sequence > unread.after && m.author.id !== me.data?.id);
  const hadUnread = unread.through > unread.after;
  const unreadCount = firstUnread ? messages.filter((m) => m.sequence > unread.after && m.sequence <= unread.through && m.author.id !== me.data?.id).length : unread.through - unread.after;
  const firstVisible = virtualizer.getVirtualItems().find((vi) => vi.end > (virtualizer.scrollOffset ?? 0));
  const lineAbove = unreadIndex === -1 || (firstVisible !== undefined && firstVisible.index > unreadIndex);
  const showUnreadBar = hadUnread && !unreadDismissed && lineAbove && initialScrolled.current;

  const jumpToUnread = async () => {
    setJumping(true);
    try {
      // Load older pages until the first unread message is in the list.
      let result = history;
      let pages = 0;
      while (!result.data?.pages.some((p) => p.messages.some((m) => m.sequence <= unread.after + 1)) && result.hasNextPage && pages < 20) {
        result = await history.fetchNextPage();
        pages += 1;
      }
      requestAnimationFrame(() => {
        const index = rowsRef.current.findIndex((r) => r.kind === "unread");
        if (index >= 0) virtualizer.scrollToIndex(index, { align: "start" });
      });
      setUnreadDismissed(true);
    } finally {
      setJumping(false);
    }
  };

  if (history.isPending) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground" role="status">
        <Loader2 className="size-5 animate-spin" aria-hidden />
        <span className="sr-only">Loading messages</span>
      </div>
    );
  }
  if (history.isError) {
    return <ErrorState title="Could not load messages" description="Check your connection and try again." onRetry={() => void history.refetch()} className="flex-1" />;
  }

  const items = virtualizer.getVirtualItems();

  return (
    <div className="relative min-h-0 flex-1">
      {showUnreadBar ? (
        <div className="absolute inset-x-3 top-2 z-10 flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground shadow-md" role="status">
          <span className="min-w-0 flex-1 truncate font-medium">
            {unreadCount} new message{unreadCount === 1 ? "" : "s"}
            {firstUnread ? ` since ${formatTime(firstUnread.createdAt)}` : ""}
          </span>
          <button type="button" onClick={() => void jumpToUnread()} disabled={jumping} className="rounded px-2 py-0.5 font-semibold hover:bg-primary-foreground/15">
            {jumping ? "Loading…" : "Jump"}
          </button>
          <button type="button" onClick={() => setUnreadDismissed(true)} className="rounded px-2 py-0.5 hover:bg-primary-foreground/15">
            Mark as read
          </button>
        </div>
      ) : null}
      <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto overscroll-contain" role="log" aria-live="polite" aria-label={`Messages in ${channel.name}`}>
        {rows.length === 0 ? (
          workspace.kind === "dm" ? (
            <EmptyState icon={MessageCircle} title={workspace.dmPeer?.displayName ?? "Deleted user"} description="This is the start of your conversation. Only the two of you can see it." />
          ) : (
            <EmptyState icon={Hash} title={`Welcome to #${channel.name}`} description={channel.topic ?? "This is the start of the channel. Say hello!"} />
          )
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }} className="w-full">
            {!history.hasNextPage && messages.length > 0 ? null : null}
            {items.map((vi) => {
              const row = rows[vi.index]!;
              return (
                <div key={vi.key} data-index={vi.index} ref={virtualizer.measureElement} className="absolute top-0 left-0 w-full" style={{ transform: `translateY(${vi.start}px)` }}>
                  {row.kind === "top" ? (
                    <div className="flex h-10 items-center justify-center text-xs text-muted-foreground">
                      {history.isFetchingNextPage ? <Loader2 className="size-4 animate-spin" aria-label="Loading older messages" /> : <span>Scroll up for older messages</span>}
                    </div>
                  ) : row.kind === "unread" ? (
                    <div className="relative mx-4 my-1 flex items-center" role="separator" aria-label="New messages">
                      <span className="h-px flex-1 bg-destructive" />
                      <span className="rounded-sm bg-destructive px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-white">New</span>
                    </div>
                  ) : row.kind === "divider" ? (
                    <div className="relative mx-4 my-2 flex items-center" role="separator" aria-label={row.label}>
                      <span className="h-px flex-1 bg-border" />
                      <span className="px-2 text-[11px] font-semibold text-muted-foreground">{row.label}</span>
                      <span className="h-px flex-1 bg-border" />
                    </div>
                  ) : row.kind === "message" ? (
                    <MessageItem
                      message={row.message}
                      compact={row.compact}
                      channel={channel}
                      workspace={workspace}
                      isMine={row.message.author.id === me.data?.id}
                      onReply={onReply}
                      onEdit={onEdit}
                      isEditing={editingId === row.message.id}
                    />
                  ) : (
                    <PendingMessageItem pending={row.pending} compact={row.compact} me={me.data!} />
                  )}
                </div>
              );
            })}
          </div>
        )}
        {rows.length > 0 && !history.hasNextPage && messages.length > 0 ? (
          <div className="sr-only">Beginning of #{channel.name}</div>
        ) : null}
      </div>
      {!atBottom && rows.length > 0 ? (
        <button
          type="button"
          onClick={() => scrollToBottom("smooth")}
          className={cn(
            "absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border bg-popover px-3 py-1.5 text-xs font-medium shadow-md transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            unseen > 0 && "border-primary/40 bg-primary text-primary-foreground hover:bg-primary/90",
          )}
        >
          <ArrowDown className="size-3.5" aria-hidden />
          {unseen > 0 ? `${unseen} new message${unseen === 1 ? "" : "s"}` : "Jump to present"}
        </button>
      ) : null}
    </div>
  );
}
