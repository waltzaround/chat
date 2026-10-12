/** Data hooks for integrations: commands, webhooks, bots and GitHub. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPatch, apiPost } from "./api";
import type {
  AvailableCommand,
  Bot,
  BotSecrets,
  GitHubAccountLink,
  GitHubAppStatus,
  GitHubFeature,
  GitHubSubscription,
  Message,
  Webhook,
  WebhookSecrets,
  WorkspaceBot,
} from "@shared/types";

export const integrationKeys = {
  commands: (workspaceId: string) => ["commands", workspaceId] as const,
  webhooks: (workspaceId: string) => ["webhooks", workspaceId] as const,
  workspaceBots: (workspaceId: string) => ["workspace-bots", workspaceId] as const,
  serverBots: ["server-bots"] as const,
  githubStatus: ["github-status"] as const,
  githubSubscriptions: (workspaceId: string) => ["github-subscriptions", workspaceId] as const,
  githubAccount: ["github-account"] as const,
};

/** What the server answers when you run a command or press a button. */
export interface InteractionResult {
  message?: Message;
  deferred?: boolean;
}

// Commands and buttons -------------------------------------------------------

export function useCommands(workspaceId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: integrationKeys.commands(workspaceId ?? ""),
    queryFn: () => apiGet<AvailableCommand[]>(`/api/workspaces/${workspaceId}/commands`),
    enabled: !!workspaceId && enabled,
    staleTime: 60_000,
  });
}

export function runCommand(channelId: string, input: { name: string; text: string; botId?: string }) {
  return apiPost<InteractionResult>(`/api/channels/${channelId}/commands`, input);
}

export function pressButton(channelId: string, messageId: string, customId: string) {
  return apiPost<InteractionResult>(`/api/channels/${channelId}/messages/${messageId}/buttons`, { customId });
}

// Webhooks -------------------------------------------------------------------

export function useWebhooks(workspaceId: string, enabled = true) {
  return useQuery({ queryKey: integrationKeys.webhooks(workspaceId), queryFn: () => apiGet<Webhook[]>(`/api/workspaces/${workspaceId}/webhooks`), enabled });
}

export function useWebhookMutations(workspaceId: string) {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: integrationKeys.webhooks(workspaceId) });
  const base = `/api/workspaces/${workspaceId}/webhooks`;
  return {
    create: useMutation({ mutationFn: (input: { channelId: string; name: string }) => apiPost<WebhookSecrets>(base, input), onSuccess: refresh }),
    update: useMutation({
      mutationFn: ({ id, ...input }: { id: string; name?: string; channelId?: string; avatarKey?: string | null }) => apiPatch<Webhook>(`${base}/${id}`, input),
      onSuccess: refresh,
    }),
    regenerate: useMutation({ mutationFn: (id: string) => apiPost<WebhookSecrets>(`${base}/${id}/regenerate`), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: string) => apiDelete(`${base}/${id}`), onSuccess: refresh }),
  };
}

// Bots in a workspace ----------------------------------------------------------

export function useWorkspaceBots(workspaceId: string, enabled = true) {
  return useQuery({ queryKey: integrationKeys.workspaceBots(workspaceId), queryFn: () => apiGet<WorkspaceBot[]>(`/api/workspaces/${workspaceId}/bots`), enabled });
}

export function useWorkspaceBotMutations(workspaceId: string) {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: integrationKeys.workspaceBots(workspaceId) });
    void qc.invalidateQueries({ queryKey: integrationKeys.commands(workspaceId) });
    void qc.invalidateQueries({ queryKey: ["members", workspaceId] });
  };
  return {
    add: useMutation({ mutationFn: (botId: string) => apiPost(`/api/workspaces/${workspaceId}/bots`, { botId }), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (botId: string) => apiDelete(`/api/workspaces/${workspaceId}/bots/${botId}`), onSuccess: refresh }),
  };
}

// Bots on the server (owner) -----------------------------------------------------

export function useServerBots(enabled = true) {
  return useQuery({ queryKey: integrationKeys.serverBots, queryFn: () => apiGet<Bot[]>("/api/server/bots"), enabled });
}

export function useServerBotMutations() {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: integrationKeys.serverBots });
  return {
    create: useMutation({ mutationFn: (input: { name: string; description?: string }) => apiPost<BotSecrets>("/api/server/bots", input), onSuccess: refresh }),
    update: useMutation({
      mutationFn: ({ id, ...input }: { id: string; name?: string; description?: string | null; eventsUrl?: string | null; avatarKey?: string | null }) => apiPatch<Bot>(`/api/server/bots/${id}`, input),
      onSuccess: refresh,
    }),
    newToken: useMutation({ mutationFn: (id: string) => apiPost<BotSecrets>(`/api/server/bots/${id}/token`), onSuccess: refresh }),
    newSigningSecret: useMutation({ mutationFn: (id: string) => apiPost<BotSecrets>(`/api/server/bots/${id}/signing-secret`), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: string) => apiDelete(`/api/server/bots/${id}`), onSuccess: refresh }),
  };
}

// GitHub ---------------------------------------------------------------------------

export function useGitHubStatus(enabled = true) {
  return useQuery({ queryKey: integrationKeys.githubStatus, queryFn: () => apiGet<GitHubAppStatus>("/api/github/status"), enabled, staleTime: 30_000 });
}

export function useForgetGitHubApp() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => apiDelete("/api/github/app"), onSuccess: () => void qc.invalidateQueries({ queryKey: integrationKeys.githubStatus }) });
}

export function useGitHubSubscriptions(workspaceId: string, enabled = true) {
  return useQuery({ queryKey: integrationKeys.githubSubscriptions(workspaceId), queryFn: () => apiGet<GitHubSubscription[]>(`/api/workspaces/${workspaceId}/github/subscriptions`), enabled });
}

export function useGitHubSubscriptionMutations(workspaceId: string) {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: integrationKeys.githubSubscriptions(workspaceId) });
  const base = `/api/workspaces/${workspaceId}/github/subscriptions`;
  return {
    create: useMutation({ mutationFn: (input: { channelId: string; repo: string; events: GitHubFeature[] }) => apiPost<GitHubSubscription>(base, input), onSuccess: refresh }),
    update: useMutation({ mutationFn: ({ id, events }: { id: string; events: GitHubFeature[] }) => apiPatch<GitHubSubscription>(`${base}/${id}`, { events }), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: string) => apiDelete(`${base}/${id}`), onSuccess: refresh }),
  };
}

export function useGitHubAccount(enabled = true) {
  return useQuery({ queryKey: integrationKeys.githubAccount, queryFn: () => apiGet<GitHubAccountLink>("/api/github/account"), enabled });
}

export function useUnlinkGitHub() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => apiDelete("/api/github/account"), onSuccess: () => void qc.invalidateQueries({ queryKey: integrationKeys.githubAccount }) });
}
