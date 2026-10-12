/**
 * Preview cards for GitHub issue and pull request links: title, state, author and
 * labels. Uses the server's GitHub App when it's installed on the repository's owner,
 * which also covers private repositories; otherwise GitHub's public API.
 */
import type { Embed } from "@shared/types";
import type { Env } from "../env";
import { createDb } from "../db";
import { normalizeEmbeds } from "./embeds";
import { COLORS, excerpt } from "./github-format";
import { githubApi, tokenForOwner } from "./github-app";
import type { Fetcher } from "./bot-events";

const LINK = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(issues|pull)\/(\d+)(?:[/?#]|$)/i;

interface IssueJson {
  number: number;
  title: string;
  html_url: string;
  state: "open" | "closed";
  state_reason?: string | null;
  draft?: boolean;
  body?: string | null;
  comments: number;
  user?: { login: string; html_url: string; avatar_url: string };
  labels?: Array<{ name: string } | string>;
  pull_request?: { merged_at: string | null };
}

export async function githubLinkPreview(env: Env, url: string, fetcher: Fetcher = fetch): Promise<Embed | null> {
  const match = LINK.exec(url);
  if (!match) return null;
  const [, owner, repo, , number] = match as unknown as [string, string, string, string, string];
  const token = await tokenForOwner(env, createDb(env.DB), owner, fetcher).catch(() => null);
  // The issues API answers for pull requests too.
  const res = await githubApi<IssueJson>(`/repos/${owner}/${repo}/issues/${number}`, { token }, fetcher);
  if (!res.ok || !res.data?.html_url) return null;
  const issue = res.data;
  const isPull = !!issue.pull_request;
  const merged = !!issue.pull_request?.merged_at;
  const state = merged ? "Merged" : issue.state === "closed" ? (issue.state_reason === "not_planned" ? "Closed as not planned" : "Closed") : issue.draft ? "Draft" : "Open";
  const color = merged ? COLORS.merged : issue.state === "closed" ? (isPull || issue.state_reason === "not_planned" ? COLORS.closed : COLORS.merged) : issue.draft ? COLORS.draft : COLORS.open;
  const labels = (issue.labels ?? []).map((l) => (typeof l === "string" ? l : l.name)).filter(Boolean);
  const [card] = await normalizeEmbeds(
    env,
    [
      {
        url: issue.html_url,
        title: `${issue.title} · #${issue.number}`,
        description: excerpt(issue.body, 300),
        color,
        author: issue.user ? { name: issue.user.login, url: issue.user.html_url, icon_url: issue.user.avatar_url } : undefined,
        fields: [
          { name: isPull ? "Pull request" : "Issue", value: state, inline: true },
          { name: "Comments", value: String(issue.comments ?? 0), inline: true },
          ...(labels.length ? [{ name: "Labels", value: labels.slice(0, 8).join(", "), inline: true }] : []),
        ],
        provider: { name: "GitHub", url: "https://github.com" },
        footer: { text: `${owner}/${repo}` },
      },
    ],
    "link",
  );
  return card ?? null;
}
