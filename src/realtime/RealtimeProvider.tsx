import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ClientEvent, ServerEvent, VoiceParticipantState } from "@shared/events";
import type { Attachment, PreferredStatus, PresenceStatus, ReplyContext } from "@shared/types";
import { createStore, type Store } from "@/lib/store";
import { keys, messageCache, workspaceCache } from "@/lib/queries";
import { WorkspaceSocket, type SocketStatus } from "./socket";

export interface PendingMessage {
  clientMessageId: string;
  channelId: string;
  content: string;
  replyTo: ReplyContext | null;
  attachments: Attachment[];
  createdAt: string;
  status: "sending" | "failed";
  error?: string;
}

export interface RealtimeState {
  status: SocketStatus;
  attempt: number;
  fatal: { code: number; reason: string } | null;
  presence: Record<string, PresenceStatus>;
  typing: Record<string, string[]>;
  voice: Record<string, VoiceParticipantState[]>;
  pending: Record<string, PendingMessage[]>;
  activeChannelId: string | null;
  /** Bumped whenever a sync completes so views can react (e.g. scroll). */
  syncVersion: number;
}

export interface SendMessageInput {
  channelId: string;
  content: string;
  attachments?: Attachment[];
  replyTo?: ReplyContext | null;
}

export interface RealtimeApi {
  store: Store<RealtimeState>;
  workspaceId: string;
  userId: string;
  send: (event: ClientEvent) => void;
  subscribeChannel: (channelId: string) => void;
  sendMessage: (input: SendMessageInput) => string;
  retryMessage: (clientMessageId: string) => void;
  discardMessage: (clientMessageId: string) => void;
  startTyping: (channelId: string) => void;
  stopTyping: (channelId: string) => void;
  markRead: (channelId: string, sequence: number) => void;
  setPresence: (status: PreferredStatus) => void;
  setVoiceState: (state: { channelId: string | null; muted?: boolean; deafened?: boolean; video?: boolean; screen?: boolean }) => void;
  reconnect: () => void;
}

const RealtimeContext = createContext<RealtimeApi | null>(null);

export function useRealtime(): RealtimeApi {
  const ctx = useContext(RealtimeContext);
  if (!ctx) throw new Error("useRealtime must be used inside RealtimeProvider");
  return ctx;
}

export function useRealtimeOptional(): RealtimeApi | null {
  return useContext(RealtimeContext);
}

const TYPING_THROTTLE_MS = 4_000;
const READ_DEBOUNCE_MS = 600;

export function RealtimeProvider({ workspaceId, userId, children }: { workspaceId: string; userId: string; children: ReactNode }) {
  const qc = useQueryClient();
  const store = useMemo(
    () =>
      createStore<RealtimeState>({
        status: "connecting",
        attempt: 0,
        fatal: null,
        presence: {},
        typing: {},
        voice: {},
        pending: {},
        activeChannelId: null,
        syncVersion: 0,
      }),
    // A new store per workspace connection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspaceId, userId],
  );
  const socketRef = useRef<WorkspaceSocket | null>(null);
  const typingSentAt = useRef(new Map<string, number>());
  const readTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const readPending = useRef(new Map<string, number>());

  useEffect(() => {
    const handleEvent = (event: ServerEvent) => {
      switch (event.type) {
        case "ready": {
          const presence: Record<string, PresenceStatus> = {};
          for (const e of event.presence) presence[e.userId] = e.status;
          store.set({ presence, voice: event.voice });
          const active = store.get().activeChannelId;
          if (active) socket.send({ type: "channel.subscribe", channelId: active, sinceSequence: messageCache.highestSequence(qc, active) || undefined });
          break;
        }
        case "channel.sync": {
          messageCache.mergeSync(qc, event.channelId, event.messages);
          workspaceCache.patchChannel(qc, workspaceId, event.channelId, (c) => ({ ...c, lastSequence: Math.max(c.lastSequence, event.lastSequence) }));
          if (!event.complete) void qc.invalidateQueries({ queryKey: keys.messages(event.channelId) });
          store.set((s) => ({ ...s, syncVersion: s.syncVersion + 1 }));
          break;
        }
        case "message.created": {
          const message = { ...event.message, reactions: event.message.reactions.map((r) => ({ ...r, me: r.userIds.includes(userId) })) };
          messageCache.upsert(qc, message);
          workspaceCache.patchChannel(qc, workspaceId, message.channelId, (c) => ({ ...c, lastSequence: Math.max(c.lastSequence, message.sequence) }));
          if (event.clientMessageId && message.author.id === userId) removePending(message.channelId, event.clientMessageId);
          if (message.author.id === userId) {
            workspaceCache.patchChannel(qc, workspaceId, message.channelId, (c) => ({ ...c, lastReadSequence: Math.max(c.lastReadSequence, message.sequence) }));
          }
          // Someone who sends a message is no longer typing.
          store.set((s) => {
            const list = s.typing[message.channelId];
            if (!list?.includes(message.author.id)) return s;
            return { ...s, typing: { ...s.typing, [message.channelId]: list.filter((id) => id !== message.author.id) } };
          });
          break;
        }
        case "message.updated":
          messageCache.update(qc, { ...event.message, reactions: event.message.reactions.map((r) => ({ ...r, me: r.userIds.includes(userId) })) });
          break;
        case "message.deleted":
          messageCache.remove(qc, event.channelId, event.messageId);
          break;
        case "reaction.updated":
          messageCache.setReactions(qc, event.channelId, event.messageId, event.reactions, userId);
          break;
        case "typing.updated":
          store.set((s) => ({ ...s, typing: { ...s.typing, [event.channelId]: event.userIds.filter((id) => id !== userId) } }));
          break;
        case "presence.updated":
          store.set((s) => {
            const presence = { ...s.presence };
            for (const e of event.entries) {
              if (e.status === "offline") delete presence[e.userId];
              else presence[e.userId] = e.status;
            }
            return { ...s, presence };
          });
          break;
        case "channel.activity":
          workspaceCache.patchChannel(qc, workspaceId, event.channelId, (c) => ({ ...c, lastSequence: Math.max(c.lastSequence, event.lastSequence) }));
          break;
        case "read.updated":
          workspaceCache.patchChannel(qc, workspaceId, event.channelId, (c) => ({ ...c, lastReadSequence: Math.max(c.lastReadSequence, event.sequence) }));
          break;
        case "voice.updated":
          store.set((s) => ({ ...s, voice: { ...s.voice, [event.channelId]: event.participants } }));
          break;
        case "workspace.updated":
          void qc.invalidateQueries({ queryKey: keys.workspace(workspaceId) });
          if (event.reason === "members" || event.reason === "roles") void qc.invalidateQueries({ queryKey: keys.members(workspaceId) });
          if (event.reason === "workspace") void qc.invalidateQueries({ queryKey: keys.workspaces });
          if (event.reason === "emojis") void qc.invalidateQueries({ queryKey: keys.emojis(workspaceId) });
          if (event.reason === "reports") void qc.invalidateQueries({ queryKey: keys.reports(workspaceId) });
          break;
        case "member.removed":
          if (event.userId === userId) {
            void qc.invalidateQueries({ queryKey: keys.workspaces });
            store.set({ fatal: { code: 4003, reason: event.reason } });
          } else {
            void qc.invalidateQueries({ queryKey: keys.members(workspaceId) });
          }
          break;
        case "ack":
          // message.created normally arrives first; this covers the edge case where it didn't.
          store.set((s) => {
            let changed = false;
            const pending: RealtimeState["pending"] = {};
            for (const [channelId, list] of Object.entries(s.pending)) {
              const next = list.filter((p) => p.clientMessageId !== event.clientMessageId);
              if (next.length !== list.length) changed = true;
              pending[channelId] = next;
            }
            return changed ? { ...s, pending } : s;
          });
          break;
        case "error":
          if (event.clientMessageId) {
            store.set((s) => ({
              ...s,
              pending: Object.fromEntries(
                Object.entries(s.pending).map(([channelId, list]) => [channelId, list.map((p) => (p.clientMessageId === event.clientMessageId ? { ...p, status: "failed" as const, error: event.message } : p))]),
              ),
            }));
          } else {
            console.warn("realtime error", event.code, event.message);
          }
          break;
        case "pong":
          break;
      }
    };

    const removePending = (channelId: string, clientMessageId: string) => {
      store.set((s) => {
        const list = s.pending[channelId];
        if (!list?.some((p) => p.clientMessageId === clientMessageId)) return s;
        return { ...s, pending: { ...s.pending, [channelId]: list.filter((p) => p.clientMessageId !== clientMessageId) } };
      });
    };

    const socket = new WorkspaceSocket(workspaceId, {
      onEvent: handleEvent,
      onStatus: (status, attempt) => store.set({ status, attempt }),
      onFatal: (code, reason) => store.set({ fatal: { code, reason } }),
    });
    socketRef.current = socket;
    socket.connect();
    return () => {
      socket.close();
      socketRef.current = null;
      for (const t of readTimers.current.values()) clearTimeout(t);
      readTimers.current.clear();
    };
  }, [workspaceId, userId, qc, store]);

  const api = useMemo<RealtimeApi>(() => {
    const send = (event: ClientEvent) => socketRef.current?.send(event);
    const flushRead = (channelId: string) => {
      const seq = readPending.current.get(channelId);
      readPending.current.delete(channelId);
      readTimers.current.delete(channelId);
      if (seq !== undefined) send({ type: "channel.read", channelId, sequence: seq });
    };
    return {
      store,
      workspaceId,
      userId,
      send,
      subscribeChannel: (channelId) => {
        if (store.get().activeChannelId === channelId) return;
        store.set({ activeChannelId: channelId });
        send({ type: "channel.subscribe", channelId, sinceSequence: messageCache.highestSequence(qc, channelId) || undefined });
      },
      sendMessage: (input) => {
        const clientMessageId = crypto.randomUUID();
        const pending: PendingMessage = {
          clientMessageId,
          channelId: input.channelId,
          content: input.content,
          replyTo: input.replyTo ?? null,
          attachments: input.attachments ?? [],
          createdAt: new Date().toISOString(),
          status: "sending",
        };
        store.set((s) => ({ ...s, pending: { ...s.pending, [input.channelId]: [...(s.pending[input.channelId] ?? []), pending] } }));
        typingSentAt.current.delete(input.channelId);
        send({
          type: "message.create",
          channelId: input.channelId,
          clientMessageId,
          content: input.content,
          attachmentIds: pending.attachments.length ? pending.attachments.map((a) => a.id) : undefined,
          replyTo: input.replyTo?.id,
        });
        return clientMessageId;
      },
      retryMessage: (clientMessageId) => {
        const all = Object.values(store.get().pending).flat();
        const p = all.find((m) => m.clientMessageId === clientMessageId);
        if (!p) return;
        store.set((s) => ({ ...s, pending: { ...s.pending, [p.channelId]: s.pending[p.channelId]!.map((m) => (m.clientMessageId === clientMessageId ? { ...m, status: "sending", error: undefined } : m)) } }));
        send({ type: "message.create", channelId: p.channelId, clientMessageId, content: p.content, attachmentIds: p.attachments.length ? p.attachments.map((a) => a.id) : undefined, replyTo: p.replyTo?.id });
      },
      discardMessage: (clientMessageId) => {
        store.set((s) => ({ ...s, pending: Object.fromEntries(Object.entries(s.pending).map(([k, list]) => [k, list.filter((m) => m.clientMessageId !== clientMessageId)])) }));
      },
      startTyping: (channelId) => {
        const last = typingSentAt.current.get(channelId) ?? 0;
        if (Date.now() - last < TYPING_THROTTLE_MS) return;
        typingSentAt.current.set(channelId, Date.now());
        send({ type: "typing.start", channelId });
      },
      stopTyping: (channelId) => {
        if (!typingSentAt.current.has(channelId)) return;
        typingSentAt.current.delete(channelId);
        send({ type: "typing.stop", channelId });
      },
      markRead: (channelId, sequence) => {
        workspaceCache.patchChannel(qc, workspaceId, channelId, (c) => (c.lastReadSequence >= sequence ? c : { ...c, lastReadSequence: sequence }));
        const prev = readPending.current.get(channelId) ?? 0;
        if (sequence <= prev) return;
        readPending.current.set(channelId, sequence);
        if (!readTimers.current.has(channelId)) readTimers.current.set(channelId, setTimeout(() => flushRead(channelId), READ_DEBOUNCE_MS));
      },
      setPresence: (status) => send({ type: "presence.set", status }),
      setVoiceState: (state) => send({ type: "voice.state", ...state }),
      reconnect: () => socketRef.current?.reconnectNow(),
    };
  }, [store, workspaceId, userId, qc]);

  return <RealtimeContext.Provider value={api}>{children}</RealtimeContext.Provider>;
}
