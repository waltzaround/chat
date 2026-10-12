/**
 * Channel subscriptions to GitHub repositories, the built-in /github command that
 * manages them, the buttons on GitHub posts, and routing the app's deliveries.
 */
import { and, eq } from "drizzle-orm";
import type { GitHubFeature, GitHubSubscription, UserSummary } from "@shared/types";
import { newId } from "@shared/id";
import { Permission, hasPermission } from "@shared/permissions";
import type { Env } from "../env";
import { schema, type Db } from "../db";
import { hubFor } from "../lib/hub";
import { isoRequired, toUserSummary } from "../lib/serialize";
import { audit } from "../lib/audit";
import { normalizeEmbeds } from "./embeds";
import { DEFAULT_GITHUB_FEATURES, GITHUB_FEATURE_LABELS, GITHUB_FEATURES, formatGitHubEvent } from "./github-format";
import { getGitHubApp, githubApi, githubBotUser, installationFor, installationToken, userGitHubToken } from "./github-app";
import type { Fetcher } from "./bot-events";

type SubscriptionRow = typeof schema.githubSubscriptions.$inferSelect;

export const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;

/** "owner/repo" from that or from a github.com URL. */
export function parseRepo(input: string): string | null {
  const trimmed = input.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "").replace(/\/+$/, "");
  return REPO_PATTERN.test(trimmed) ? trimmed.toLowerCase() : null;
}

export function toSubscription(row: SubscriptionRow, creator: UserSummary | null): GitHubSubscription {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    channelId: row.channelId,
    repo: row.repo,
    events: row.events.split(",").filter((f): f is GitHubFeature => GITHUB_FEATURES.includes(f as GitHubFeature)),
    createdBy: creator,
    createdAt: isoRequired(row.createdAt),
  };
}

export class SubscriptionError extends Error {}

/**
 * Subscribes a channel to a repository after checking the app can see it. Subscribing
 * again replaces the features.
 */
export async function subscribe(env: Env, db: Db, input: { workspaceId: string; channelId: string; repo: string; events: GitHubFeature[]; userId: string }, fetcher: Fetcher = fetch): Promise<SubscriptionRow> {
  const config = await getGitHubApp(env);
  if (!config) throw new SubscriptionError("The server owner hasn't set up GitHub yet. It's in Server settings.");
  const [owner] = input.repo.split("/") as [string, string];
  const installation = await installationFor(db, owner);
  const installUrl = `https://github.com/apps/${config.slug}/installations/new`;
  if (!installation) throw new SubscriptionError(`The GitHub App isn't installed on ${owner}. Install it at ${installUrl}, then try again.`);
  const token = await installationToken(env, installation.id, fetcher);
  const repo = token ? await githubApi(`/repos/${input.repo}`, { token }, fetcher) : null;
  if (!repo?.ok) throw new SubscriptionError(`The GitHub App can't see ${input.repo}. Check the name, or give the app access to it on GitHub.`);
  const events = [...new Set(input.events)].filter((f) => f !== "stars").join(",");
  const [row] = await db
    .insert(schema.githubSubscriptions)
    .values({ id: newId(), workspaceId: input.workspaceId, channelId: input.channelId, repo: input.repo, events, createdBy: input.userId, createdAt: new Date() })
    .onConflictDoUpdate({ target: [schema.githubSubscriptions.channelId, schema.githubSubscriptions.repo], set: { events } })
    .returning();
  await audit(db, { workspaceId: input.workspaceId, actorUserId: input.userId, action: "github.subscribed", targetType: "channel", targetId: input.channelId, details: { repo: input.repo, events } });
  return row!;
}

export async function unsubscribe(db: Db, input: { workspaceId: string; channelId: string; repo: string; userId: string }): Promise<boolean> {
  const removed = await db
    .delete(schema.githubSubscriptions)
    .where(and(eq(schema.githubSubscriptions.channelId, input.channelId), eq(schema.githubSubscriptions.repo, input.repo)))
    .returning({ id: schema.githubSubscriptions.id });
  if (removed.length) await audit(db, { workspaceId: input.workspaceId, actorUserId: input.userId, action: "github.unsubscribed", targetType: "channel", targetId: input.channelId, details: { repo: input.repo } });
  return removed.length > 0;
}

export function parseFeatures(words: string[]): { features: GitHubFeature[]; unknown: string[] } {
  const features: GitHubFeature[] = [];
  const unknown: string[] = [];
  for (const word of words.flatMap((w) => w.split(",")).map((w) => w.trim().toLowerCase()).filter(Boolean)) {
    if (GITHUB_FEATURES.includes(word as GitHubFeature) && word !== "stars") features.push(word as GitHubFeature);
    else unknown.push(word);
  }
  return { features, unknown };
}

const HELP = [
  "**/github subscribe owner/repo** posts that repository's activity here.",
  `Add features to choose what: ${GITHUB_FEATURES.filter((f) => f !== "stars").join(", ")}. Without any you get ${DEFAULT_GITHUB_FEATURES.join(", ")}.`,
  "**/github unsubscribe owner/repo** stops it.",
  "**/github list** shows this channel's subscriptions.",
].join("\n");

/** The built-in /github command. Returns text for a reply only the caller sees. */
export async function runGitHubCommand(
  env: Env,
  db: Db,
  input: { workspaceId: string; channelId: string; user: { id: string }; basePermissions: number; text: string },
  fetcher: Fetcher = fetch,
): Promise<string> {
  const [action = "help", target = "", ...rest] = input.text.trim().split(/\s+/).filter(Boolean);
  const verb = action.toLowerCase();
  if (verb === "list") {
    const rows = await db.select().from(schema.githubSubscriptions).where(eq(schema.githubSubscriptions.channelId, input.channelId));
    if (rows.length === 0) return "This channel isn't subscribed to any repositories. Try **/github subscribe owner/repo**.";
    return ["This channel gets activity from:", ...rows.map((r) => `• **${r.repo}**: ${r.events.split(",").join(", ")}`)].join("\n");
  }
  if (verb !== "subscribe" && verb !== "unsubscribe") return HELP;
  if (!hasPermission(input.basePermissions, Permission.MANAGE_INTEGRATIONS)) return "You need the Manage integrations permission to change this channel's GitHub subscriptions.";
  const repo = parseRepo(target);
  if (!repo) return `Name the repository as owner/repo, like **/github ${verb} octocat/hello-world**.`;
  if (verb === "unsubscribe") {
    return (await unsubscribe(db, { workspaceId: input.workspaceId, channelId: input.channelId, repo, userId: input.user.id })) ? `Unsubscribed from **${repo}**.` : `This channel wasn't subscribed to **${repo}**.`;
  }
  const { features, unknown } = parseFeatures(rest);
  if (unknown.length) return `I don't know ${unknown.map((u) => `"${u}"`).join(", ")}. Features are: ${GITHUB_FEATURES.filter((f) => f !== "stars").join(", ")}.`;
  try {
    const row = await subscribe(env, db, { workspaceId: input.workspaceId, channelId: input.channelId, repo, events: features.length ? features : DEFAULT_GITHUB_FEATURES, userId: input.user.id }, fetcher);
    return `Subscribed to **${repo}**. You'll see: ${row.events.split(",").map((f) => GITHUB_FEATURE_LABELS[f as GitHubFeature]?.toLowerCase() ?? f).join("; ")}.`;
  } catch (err) {
    if (err instanceof SubscriptionError) return err.message;
    throw err;
  }
}

/** A Close or Reopen button on a GitHub post, acting as the person who pressed it. */
export async function runGitHubButton(env: Env, db: Db, userId: string, customId: string, fetcher: Fetcher = fetch): Promise<string> {
  const match = /^gh:(close|reopen):([\w.-]+\/[\w.-]+):(\d+)$/.exec(customId);
  if (!match) return "That button doesn't do anything.";
  const [, action, repo, number] = match as unknown as [string, "close" | "reopen", string, string];
  const token = await userGitHubToken(env, db, userId, fetcher);
  if (!token) return "Link your GitHub account first, in Settings under Profile. Then GitHub knows who's closing it.";
  const res = await githubApi(`/repos/${repo}/issues/${number}`, { token, method: "PATCH", body: { state: action === "close" ? "closed" : "open" } }, fetcher);
  if (res.ok) return `${action === "close" ? "Closed" : "Reopened"} ${repo}#${number}.`;
  if (res.status === 403 || res.status === 404) return `GitHub didn't let you ${action} ${repo}#${number}. You may not have permission in that repository.`;
  return `GitHub couldn't ${action} ${repo}#${number} (error ${res.status}). Try again on GitHub.`;
}

/** Posts one of the app's deliveries into every channel subscribed to its repository. */
export async function routeGitHubAppEvent(env: Env, db: Db, event: string, payload: Record<string, unknown>, deliveryId: string): Promise<number> {
  const repoName = (payload.repository as { full_name?: string } | undefined)?.full_name?.toLowerCase();
  if (!repoName) return 0;
  const subscriptions = await db.select().from(schema.githubSubscriptions).where(eq(schema.githubSubscriptions.repo, repoName));
  if (subscriptions.length === 0) return 0;
  const formatted = formatGitHubEvent(event, payload);
  if (!formatted) return 0;
  const bot = await githubBotUser(env, db);
  const embeds = await normalizeEmbeds(env, formatted.embeds);
  let posted = 0;
  for (const sub of subscriptions) {
    if (formatted.feature && !sub.events.split(",").includes(formatted.feature)) continue;
    const result = await hubFor(env, sub.workspaceId).createMessage({
      userId: bot.id,
      channelId: sub.channelId,
      content: formatted.content,
      clientMessageId: `gh:${deliveryId}`.slice(0, 64),
      attachmentIds: [],
      replyTo: null,
      integration: { permissions: Permission.SEND_MESSAGES },
      embeds,
      components: formatted.components ?? [],
      // Text from GitHub could name people here by accident.
      suppressMentions: true,
    });
    if (result.ok) posted++;
  }
  return posted;
}

export async function listSubscriptions(db: Db, workspaceId: string): Promise<GitHubSubscription[]> {
  const rows = await db.select({ sub: schema.githubSubscriptions, user: schema.users }).from(schema.githubSubscriptions).leftJoin(schema.users, eq(schema.users.id, schema.githubSubscriptions.createdBy)).where(eq(schema.githubSubscriptions.workspaceId, workspaceId));
  return rows.map((r) => toSubscription(r.sub, r.user ? toUserSummary(r.user) : null));
}
