import { useMemo } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api, apiDelete, apiGet, apiPatch, apiPost, apiPut } from "./api";
import type {
  AuditEntry,
  AuthConfig,
  Ban,
  Channel,
  CurrentUser,
  CustomEmoji,
  Invite,
  InvitePreview,
  Member,
  Message,
  MessagePage,
  PermissionOverwrite,
  Role,
  SearchResponse,
  PasswordResetLink,
  ReportedMessage,
  ServerSettings,
  ServerUser,
  WorkspaceDetail,
  WorkspaceSummary,
} from "@shared/types";
import type { CreateChannelInput, CreateInviteInput, CreateRoleInput, CreateWorkspaceInput, UpdateServerSettingsInput, ReportMessageInput, DeleteAccountInput } from "@shared/schemas";

export const keys = {
  me: ["me"] as const,
  authConfig: ["auth-config"] as const,
  serverSettings: ["server-settings"] as const,
  serverUsers: (q: string) => ["server-users", q] as const,
  workspaces: ["workspaces"] as const,
  workspace: (id: string) => ["workspace", id] as const,
  members: (id: string) => ["members", id] as const,
  messages: (channelId: string) => ["messages", channelId] as const,
  invites: (id: string) => ["invites", id] as const,
  invite: (code: string) => ["invite", code] as const,
  bans: (id: string) => ["bans", id] as const,
  audit: (id: string) => ["audit", id] as const,
  reports: (id: string) => ["reports", id] as const,
  overwrites: (channelId: string) => ["overwrites", channelId] as const,
  emojis: (id: string) => ["emojis", id] as const,
  search: (id: string, q: string, channelId?: string, authorId?: string) => ["search", id, q, channelId ?? "", authorId ?? ""] as const,
};

export function useAuthConfig() {
  return useQuery({ queryKey: keys.authConfig, queryFn: () => apiGet<AuthConfig>("/api/auth-config"), staleTime: Infinity });
}

export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: () => apiGet<CurrentUser>("/api/me"), retry: false, staleTime: 60_000 });
}

export function useServerSettings(enabled = true) {
  return useQuery({ queryKey: keys.serverSettings, queryFn: () => apiGet<ServerSettings>("/api/server"), enabled });
}

export function useUpdateServerSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateServerSettingsInput) => apiPatch<ServerSettings>("/api/server", input),
    onSuccess: (settings) => {
      qc.setQueryData(keys.serverSettings, settings);
      void qc.invalidateQueries({ queryKey: keys.authConfig });
      void qc.invalidateQueries({ queryKey: keys.me });
    },
  });
}

export function useServerUsers(q: string) {
  return useQuery({
    queryKey: keys.serverUsers(q),
    queryFn: () => apiGet<ServerUser[]>(`/api/server/users?q=${encodeURIComponent(q)}`),
    placeholderData: (previous) => previous,
  });
}

export function useDeleteServerUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, deleteMessages }: { userId: string; deleteMessages: boolean }) => api<void>(`/api/server/users/${userId}`, { method: "DELETE", json: { deleteMessages } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["server-users"] }),
  });
}

export function useDeleteMe() {
  return useMutation({ mutationFn: (input: DeleteAccountInput) => api<void>("/api/me", { method: "DELETE", json: input }) });
}

export function useTransferOwnership(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => apiPost<void>(`/api/workspaces/${workspaceId}/owner`, { userId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.workspace(workspaceId) });
      void qc.invalidateQueries({ queryKey: keys.members(workspaceId) });
    },
  });
}

export function useSetSuspended() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, suspended }: { userId: string; suspended: boolean }) =>
      suspended ? apiPost<void>(`/api/server/users/${userId}/suspension`, {}) : apiDelete(`/api/server/users/${userId}/suspension`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["server-users"] }),
  });
}

export function useCreatePasswordResetLink() {
  return useMutation({ mutationFn: (userId: string) => apiPost<PasswordResetLink>(`/api/server/users/${userId}/password-reset`, {}) });
}

export function useWorkspaces() {
  return useQuery({ queryKey: keys.workspaces, queryFn: () => apiGet<WorkspaceSummary[]>("/api/me/workspaces"), staleTime: 30_000 });
}

export function useWorkspace(id: string | undefined) {
  return useQuery({ queryKey: keys.workspace(id ?? ""), queryFn: () => apiGet<WorkspaceDetail>(`/api/workspaces/${id}`), enabled: !!id, staleTime: 30_000 });
}

export function useMembers(workspaceId: string | undefined) {
  return useQuery({ queryKey: keys.members(workspaceId ?? ""), queryFn: () => apiGet<Member[]>(`/api/workspaces/${workspaceId}/members`), enabled: !!workspaceId, staleTime: 60_000 });
}

export const MESSAGE_PAGE_SIZE = 50;

/**
 * Message history is an infinite query paginated backwards by sequence.
 * pages[0] is the newest page; realtime events are merged into it.
 */
export function useMessageHistory(channelId: string | undefined) {
  return useInfiniteQuery({
    queryKey: keys.messages(channelId ?? ""),
    enabled: !!channelId,
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => apiGet<MessagePage>(`/api/channels/${channelId}/messages?limit=${MESSAGE_PAGE_SIZE}${pageParam ? `&before=${pageParam}` : ""}`),
    getNextPageParam: (lastPage) => (lastPage.hasMore && lastPage.messages.length ? lastPage.messages[0]!.sequence : undefined),
    staleTime: Infinity,
    gcTime: 10 * 60 * 1000,
  });
}

export type MessageHistoryData = { pages: MessagePage[]; pageParams: (number | undefined)[] };

/** Cache helpers used by the realtime layer. */
export const messageCache = {
  upsert(qc: QueryClient, message: Message) {
    qc.setQueryData<MessageHistoryData>(keys.messages(message.channelId), (data) => {
      if (!data) return data;
      const pages = data.pages.map((p) => ({ ...p, messages: p.messages.filter((m) => m.id !== message.id) }));
      const first = pages[0] ?? { messages: [], hasMore: false };
      const messages = [...first.messages, message].sort((a, b) => a.sequence - b.sequence);
      pages[0] = { ...first, messages };
      return { ...data, pages };
    });
  },
  update(qc: QueryClient, message: Message) {
    qc.setQueryData<MessageHistoryData>(keys.messages(message.channelId), (data) => {
      if (!data) return data;
      return { ...data, pages: data.pages.map((p) => ({ ...p, messages: p.messages.map((m) => (m.id === message.id ? message : m)) })) };
    });
  },
  remove(qc: QueryClient, channelId: string, messageId: string) {
    qc.setQueryData<MessageHistoryData>(keys.messages(channelId), (data) => {
      if (!data) return data;
      return {
        ...data,
        pages: data.pages.map((p) => ({
          ...p,
          messages: p.messages
            .filter((m) => m.id !== messageId)
            .map((m) => (m.replyTo?.id === messageId ? { ...m, replyTo: { ...m.replyTo, deleted: true, content: "" } } : m)),
        })),
      };
    });
  },
  setReactions(qc: QueryClient, channelId: string, messageId: string, reactions: Message["reactions"], myUserId: string) {
    const withMe = reactions.map((r) => ({ ...r, me: r.userIds.includes(myUserId) }));
    qc.setQueryData<MessageHistoryData>(keys.messages(channelId), (data) => {
      if (!data) return data;
      return { ...data, pages: data.pages.map((p) => ({ ...p, messages: p.messages.map((m) => (m.id === messageId ? { ...m, reactions: withMe } : m)) })) };
    });
  },
  mergeSync(qc: QueryClient, channelId: string, messages: Message[]) {
    if (messages.length === 0) return;
    qc.setQueryData<MessageHistoryData>(keys.messages(channelId), (data) => {
      if (!data) return data;
      const seen = new Set(messages.map((m) => m.id));
      const pages = data.pages.map((p) => ({ ...p, messages: p.messages.filter((m) => !seen.has(m.id)) }));
      const first = pages[0] ?? { messages: [], hasMore: false };
      pages[0] = { ...first, messages: [...first.messages, ...messages].sort((a, b) => a.sequence - b.sequence) };
      return { ...data, pages };
    });
  },
  highestSequence(qc: QueryClient, channelId: string): number {
    const data = qc.getQueryData<MessageHistoryData>(keys.messages(channelId));
    let max = 0;
    for (const p of data?.pages ?? []) for (const m of p.messages) if (m.sequence > max) max = m.sequence;
    return max;
  },
};

export const workspaceCache = {
  patchChannel(qc: QueryClient, workspaceId: string, channelId: string, patch: Partial<Channel> | ((c: Channel) => Channel)) {
    qc.setQueryData<WorkspaceDetail>(keys.workspace(workspaceId), (ws) => {
      if (!ws) return ws;
      return { ...ws, channels: ws.channels.map((c) => (c.id === channelId ? (typeof patch === "function" ? patch(c) : { ...c, ...patch }) : c)) };
    });
  },

  /** Adjust a workspace's mention badge in the rail. */
  addWorkspaceMentions(qc: QueryClient, workspaceId: string, delta: number) {
    qc.setQueryData<WorkspaceSummary[]>(keys.workspaces, (list) => list?.map((w) => (w.id === workspaceId ? { ...w, mentionCount: Math.max(0, w.mentionCount + delta) } : w)));
  },

  /** A message mentioning you arrived in a channel you aren't reading. */
  addMention(qc: QueryClient, workspaceId: string, channelId: string, sequence: number) {
    workspaceCache.patchChannel(qc, workspaceId, channelId, (c) => ({ ...c, mentionCount: c.mentionCount + 1, lastSequence: Math.max(c.lastSequence, sequence) }));
    workspaceCache.addWorkspaceMentions(qc, workspaceId, 1);
  },

  /** Move the read marker; once caught up, the channel's mentions are read too. Returns how many were cleared. */
  markChannelRead(qc: QueryClient, workspaceId: string, channelId: string, sequence: number): number {
    let cleared = 0;
    workspaceCache.patchChannel(qc, workspaceId, channelId, (c) => {
      const lastReadSequence = Math.max(c.lastReadSequence, sequence);
      const caughtUp = lastReadSequence >= c.lastSequence && c.mentionCount > 0;
      if (caughtUp) cleared = c.mentionCount;
      return lastReadSequence === c.lastReadSequence && !caughtUp ? c : { ...c, lastReadSequence, mentionCount: caughtUp ? 0 : c.mentionCount };
    });
    if (cleared) workspaceCache.addWorkspaceMentions(qc, workspaceId, -cleared);
    return cleared;
  },
};

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function useCreateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWorkspaceInput) => apiPost<WorkspaceDetail>("/api/workspaces", input),
    onSuccess: (ws) => {
      qc.setQueryData(keys.workspace(ws.id), ws);
      void qc.invalidateQueries({ queryKey: keys.workspaces });
    },
  });
}

export function useUpdateWorkspace(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name?: string; iconKey?: string | null }) => apiPatch<WorkspaceDetail>(`/api/workspaces/${workspaceId}`, input),
    onSuccess: (ws) => {
      qc.setQueryData(keys.workspace(ws.id), ws);
      void qc.invalidateQueries({ queryKey: keys.workspaces });
    },
  });
}

export function useCreateChannel(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateChannelInput) => apiPost<Channel>(`/api/workspaces/${workspaceId}/channels`, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.workspace(workspaceId) }),
  });
}

/** Persists a new sidebar order with an optimistic cache update and rollback on failure. */
export function useReorderLayout(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { categories: { id: string; position: number }[]; channels: { id: string; position: number; categoryId: string | null }[] }) => apiPut(`/api/workspaces/${workspaceId}/reorder`, input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: keys.workspace(workspaceId) });
      const previous = qc.getQueryData<WorkspaceDetail>(keys.workspace(workspaceId));
      if (previous) {
        const catPos = new Map(input.categories.map((c) => [c.id, c.position]));
        const chPos = new Map(input.channels.map((c) => [c.id, c]));
        qc.setQueryData<WorkspaceDetail>(keys.workspace(workspaceId), {
          ...previous,
          categories: previous.categories.map((c) => ({ ...c, position: catPos.get(c.id) ?? c.position })),
          channels: previous.channels.map((c) => {
            const p = chPos.get(c.id);
            return p ? { ...c, position: p.position, categoryId: p.categoryId } : c;
          }),
        });
      }
      return { previous };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.previous) qc.setQueryData(keys.workspace(workspaceId), ctx.previous);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.workspace(workspaceId) }),
  });
}

export function useCreateCategory(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string }) => apiPost(`/api/workspaces/${workspaceId}/categories`, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.workspace(workspaceId) }),
  });
}

export function useUpdateChannel(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ channelId, ...input }: { channelId: string; name?: string; topic?: string | null; categoryId?: string | null; position?: number }) => apiPatch(`/api/channels/${channelId}`, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.workspace(workspaceId) }),
  });
}

export function useDeleteChannel(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (channelId: string) => apiDelete(`/api/channels/${channelId}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.workspace(workspaceId) }),
  });
}

export function useUpdateCategory(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ categoryId, ...input }: { categoryId: string; name?: string; position?: number }) => apiPatch(`/api/workspaces/${workspaceId}/categories/${categoryId}`, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.workspace(workspaceId) }),
  });
}

export function useDeleteCategory(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (categoryId: string) => apiDelete(`/api/workspaces/${workspaceId}/categories/${categoryId}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.workspace(workspaceId) }),
  });
}

export function useInvites(workspaceId: string, enabled = true) {
  return useQuery({ queryKey: keys.invites(workspaceId), queryFn: () => apiGet<Invite[]>(`/api/workspaces/${workspaceId}/invites`), enabled });
}

export function useCreateInvite(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateInviteInput) => apiPost<Invite>(`/api/workspaces/${workspaceId}/invites`, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.invites(workspaceId) }),
  });
}

export function useRevokeInvite(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => apiDelete(`/api/workspaces/${workspaceId}/invites/${code}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.invites(workspaceId) }),
  });
}

export function useInvitePreview(code: string | undefined) {
  return useQuery({ queryKey: keys.invite(code ?? ""), queryFn: () => apiGet<InvitePreview>(`/api/invites/${code}`), enabled: !!code, retry: false });
}

export function useAcceptInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => apiPost<{ workspaceId: string; alreadyMember: boolean }>(`/api/invites/${code}/accept`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.workspaces }),
  });
}

export function useUpdateMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { displayName?: string; username?: string; bio?: string | null; status?: CurrentUser["status"]; avatarKey?: string | null }) => apiPatch<CurrentUser>("/api/me", input),
    onSuccess: (me) => qc.setQueryData(keys.me, me),
  });
}

export function useRoles(workspaceId: string) {
  return useQuery({ queryKey: [...keys.workspace(workspaceId), "roles"], queryFn: () => apiGet<Role[]>(`/api/workspaces/${workspaceId}/roles`) });
}

export function useRoleMutations(workspaceId: string) {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: keys.workspace(workspaceId) });
    void qc.invalidateQueries({ queryKey: keys.members(workspaceId) });
  };
  const create = useMutation({ mutationFn: (input: CreateRoleInput) => apiPost<Role>(`/api/workspaces/${workspaceId}/roles`, input), onSuccess: invalidate });
  const update = useMutation({
    mutationFn: ({ roleId, ...input }: { roleId: string; name?: string; colour?: string | null; permissions?: number; position?: number }) => apiPatch<Role>(`/api/workspaces/${workspaceId}/roles/${roleId}`, input),
    onSuccess: invalidate,
  });
  const remove = useMutation({ mutationFn: (roleId: string) => apiDelete(`/api/workspaces/${workspaceId}/roles/${roleId}`), onSuccess: invalidate });
  const setMemberRoles = useMutation({
    mutationFn: ({ userId, roleIds }: { userId: string; roleIds: string[] }) => apiPut(`/api/workspaces/${workspaceId}/members/${userId}/roles`, { roleIds }),
    onSuccess: invalidate,
  });
  return { create, update, remove, setMemberRoles };
}

export function useMemberMutations(workspaceId: string) {
  const qc = useQueryClient();
  const invalidate = () => void qc.invalidateQueries({ queryKey: keys.members(workspaceId) });
  const update = useMutation({
    mutationFn: ({ userId, ...input }: { userId: string; nickname?: string | null; timeoutUntil?: string | null }) => apiPatch(`/api/workspaces/${workspaceId}/members/${userId}`, input),
    onSuccess: () => {
      invalidate();
      void qc.invalidateQueries({ queryKey: keys.workspace(workspaceId) });
    },
  });
  const kick = useMutation({ mutationFn: (userId: string) => apiDelete(`/api/workspaces/${workspaceId}/members/${userId}`), onSuccess: invalidate });
  const ban = useMutation({
    mutationFn: ({ userId, reason, deleteRecentMessages }: { userId: string; reason?: string | null; deleteRecentMessages?: boolean }) => apiPut(`/api/workspaces/${workspaceId}/bans/${userId}`, { reason, deleteRecentMessages }),
    onSuccess: () => {
      invalidate();
      void qc.invalidateQueries({ queryKey: keys.bans(workspaceId) });
    },
  });
  const unban = useMutation({ mutationFn: (userId: string) => apiDelete(`/api/workspaces/${workspaceId}/bans/${userId}`), onSuccess: () => void qc.invalidateQueries({ queryKey: keys.bans(workspaceId) }) });
  const leave = useMutation({ mutationFn: () => apiPost(`/api/workspaces/${workspaceId}/leave`), onSuccess: () => void qc.invalidateQueries({ queryKey: keys.workspaces }) });
  return { update, kick, ban, unban, leave };
}

export function useBans(workspaceId: string, enabled = true) {
  return useQuery({ queryKey: keys.bans(workspaceId), queryFn: () => apiGet<Ban[]>(`/api/workspaces/${workspaceId}/bans`), enabled });
}

export function useAuditLog(workspaceId: string, enabled = true) {
  return useQuery({ queryKey: keys.audit(workspaceId), queryFn: () => apiGet<AuditEntry[]>(`/api/workspaces/${workspaceId}/audit-log`), enabled });
}

export function useReports(workspaceId: string, enabled = true) {
  return useQuery({ queryKey: keys.reports(workspaceId), queryFn: () => apiGet<ReportedMessage[]>(`/api/workspaces/${workspaceId}/reports`), enabled });
}

export function useReportMessage(channelId: string) {
  return useMutation({
    mutationFn: ({ messageId, ...input }: { messageId: string } & ReportMessageInput) => apiPost<void>(`/api/channels/${channelId}/messages/${messageId}/report`, input),
  });
}

export function useResolveReport(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, action }: { messageId: string; action: "remove" | "dismiss" }) =>
      apiPost<void>(`/api/workspaces/${workspaceId}/reports/${messageId}/resolve`, { action }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.reports(workspaceId) }),
  });
}

export function useOverwrites(channelId: string | undefined) {
  return useQuery({ queryKey: keys.overwrites(channelId ?? ""), queryFn: () => apiGet<PermissionOverwrite[]>(`/api/channels/${channelId}/overwrites`), enabled: !!channelId });
}

export function useOverwriteMutations(channelId: string, workspaceId: string) {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: keys.overwrites(channelId) });
    void qc.invalidateQueries({ queryKey: keys.workspace(workspaceId) });
  };
  const set = useMutation({
    mutationFn: (input: { targetType: "role" | "user"; targetId: string; allow: number; deny: number }) => apiPut(`/api/channels/${channelId}/overwrites`, input),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: ({ targetType, targetId }: { targetType: "role" | "user"; targetId: string }) => apiDelete(`/api/channels/${channelId}/overwrites/${targetType}/${targetId}`),
    onSuccess: invalidate,
  });
  return { set, remove };
}

export function useEmojis(workspaceId: string | undefined) {
  return useQuery({ queryKey: keys.emojis(workspaceId ?? ""), queryFn: () => apiGet<CustomEmoji[]>(`/api/workspaces/${workspaceId}/emojis`), enabled: !!workspaceId, staleTime: 5 * 60_000 });
}

const EMPTY_EMOJI_MAP = new Map<string, CustomEmoji>();

/** Custom emojis keyed by shortcode name, memoised on the query result. */
export function useEmojiMap(workspaceId: string | undefined): Map<string, CustomEmoji> {
  const { data } = useEmojis(workspaceId);
  return useMemo(() => (data ? new Map(data.map((e) => [e.name, e])) : EMPTY_EMOJI_MAP), [data]);
}

export function useCreateEmoji(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; key: string }) => apiPost<CustomEmoji>(`/api/workspaces/${workspaceId}/emojis`, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.emojis(workspaceId) }),
  });
}

export function useDeleteEmoji(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (emojiId: string) => apiDelete(`/api/workspaces/${workspaceId}/emojis/${emojiId}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.emojis(workspaceId) }),
  });
}

export function useSearch(workspaceId: string, q: string, filters: { channelId?: string; authorId?: string }) {
  return useQuery({
    queryKey: keys.search(workspaceId, q, filters.channelId, filters.authorId),
    queryFn: () => {
      const params = new URLSearchParams({ q, limit: "25" });
      if (filters.channelId) params.set("channelId", filters.channelId);
      if (filters.authorId) params.set("authorId", filters.authorId);
      return apiGet<SearchResponse>(`/api/workspaces/${workspaceId}/search?${params}`);
    },
    enabled: q.trim().length > 0,
    staleTime: 30_000,
  });
}

export function useMarkRead() {
  return useMutation({ mutationFn: ({ channelId, sequence }: { channelId: string; sequence: number }) => api(`/api/channels/${channelId}/read`, { method: "POST", json: { sequence } }) });
}
