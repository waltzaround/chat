/**
 * GitHub webhook deliveries as chat messages. Shared by webhooks' /github endpoint
 * and the server's GitHub App. Returns loose cards; normalizeEmbeds() checks them.
 */
import type { ActionRow, GitHubFeature } from "@shared/types";

/* eslint-disable @typescript-eslint/no-explicit-any -- GitHub payloads are large and loosely typed. */
type Payload = any;

export interface FormattedGitHubEvent {
  /** Which subscription feature this belongs to. Null always posts (e.g. ping). */
  feature: GitHubFeature | null;
  content: string;
  embeds: Record<string, unknown>[];
  /** Buttons, for posts from the GitHub App. Keyed "gh:close:owner/repo:number". */
  components?: ActionRow[];
}

export const GITHUB_FEATURES: GitHubFeature[] = ["issues", "pulls", "commits", "releases", "reviews", "comments", "workflows", "branches", "stars"];
/** What `/github subscribe owner/repo` turns on when no features are named. */
export const DEFAULT_GITHUB_FEATURES: GitHubFeature[] = ["issues", "pulls", "commits", "releases", "workflows"];
export const GITHUB_FEATURE_LABELS: Record<GitHubFeature, string> = {
  issues: "Issues opened, closed and reopened",
  pulls: "Pull requests opened, merged, closed and ready for review",
  commits: "Commits pushed",
  releases: "Releases published",
  reviews: "Pull request reviews",
  comments: "Comments on issues, pull requests and commits",
  workflows: "Failed GitHub Actions runs",
  branches: "Branches and tags created or deleted",
  stars: "Stars and forks (webhooks only)",
};

export const COLORS = {
  open: 0x1f883d,
  merged: 0x8250df,
  closed: 0xcf222e,
  draft: 0x6e7781,
  neutral: 0x0969da,
  approved: 0x1f883d,
  changes: 0xcf222e,
} as const;

/** Stops text from GitHub being read as formatting. */
export function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_~[\]<>|#])/g, "\\$1");
}

/** GitHub text as a short excerpt: comments from templates removed, cut at a word. */
export function excerpt(text: unknown, max = 500): string | undefined {
  if (typeof text !== "string") return undefined;
  const cleaned = text.replace(/<!--[\s\S]*?-->/g, "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!cleaned) return undefined;
  if (cleaned.length <= max) return cleaned;
  const cut = cleaned.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 40)).trimEnd()}…`;
}

const firstLine = (text: string, max = 60): string => {
  const line = text.split("\n")[0]!.trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

function sender(p: Payload): Record<string, unknown> | undefined {
  const s = p.sender;
  if (!s?.login) return undefined;
  return { name: s.login, url: s.html_url, icon_url: s.avatar_url };
}

const repoName = (p: Payload): string => p.repository?.full_name ?? p.organization?.login ?? "GitHub";

function issueButtons(p: Payload, kind: "issue" | "pull", number: number, open: boolean): ActionRow[] {
  const repo = String(p.repository?.full_name ?? "").toLowerCase();
  if (!repo) return [];
  const noun = kind === "pull" ? "pull request" : "issue";
  return [
    {
      type: "row",
      components: [
        open
          ? { type: "button", style: "danger", label: `Close ${noun}`, customId: `gh:close:${repo}:${number}` }
          : { type: "button", style: "secondary", label: `Reopen ${noun}`, customId: `gh:reopen:${repo}:${number}` },
      ],
    },
  ];
}

/**
 * The message for one delivery, or null for events and actions we don't post
 * (edits, labels, assignments, successful CI runs, pushes with no commits...).
 */
export function formatGitHubEvent(event: string, p: Payload): FormattedGitHubEvent | null {
  const repo = repoName(p);
  const author = sender(p);
  switch (event) {
    case "ping": {
      const where = p.repository?.full_name ?? (p.organization?.login ? `the ${p.organization.login} organization` : "GitHub");
      return { feature: null, content: `GitHub is connected. Activity from ${where} will appear here.`, embeds: [] };
    }

    case "push": {
      const ref = String(p.ref ?? "");
      const commits: Payload[] = Array.isArray(p.commits) ? p.commits : [];
      if (!ref.startsWith("refs/heads/") || commits.length === 0) return null;
      const branch = ref.slice("refs/heads/".length);
      const shown = commits.slice(0, 5).map((c) => {
        const sha = String(c.id ?? "").slice(0, 7);
        const who = c.author?.username ?? c.author?.name ?? "";
        return `[\`${sha}\`](${c.url}) ${escapeMarkdown(firstLine(String(c.message ?? "")))}${who ? ` - ${escapeMarkdown(who)}` : ""}`;
      });
      if (commits.length > 5) shown.push(`…and ${commits.length - 5} more`);
      const count = `${commits.length} new commit${commits.length === 1 ? "" : "s"}`;
      return {
        feature: "commits",
        content: "",
        embeds: [{ title: `[${repo}:${branch}] ${p.forced ? `${count} (force-pushed)` : count}`, url: p.compare, description: shown.join("\n"), color: COLORS.neutral, author }],
      };
    }

    case "create":
    case "delete": {
      const kind = p.ref_type === "tag" ? "Tag" : p.ref_type === "branch" ? "Branch" : null;
      if (!kind) return null;
      const verb = event === "create" ? "created" : "deleted";
      return { feature: "branches", content: "", embeds: [{ title: `[${repo}] ${kind} ${verb}: ${p.ref}`, url: event === "create" ? `${p.repository?.html_url}/tree/${encodeURIComponent(p.ref)}` : p.repository?.html_url, color: event === "create" ? COLORS.neutral : COLORS.draft, author }] };
    }

    case "pull_request": {
      const pr = p.pull_request;
      if (!pr) return null;
      let title: string;
      let color: number;
      let open = true;
      switch (p.action) {
        case "opened":
          title = pr.draft ? "Draft pull request opened" : "Pull request opened";
          color = pr.draft ? COLORS.draft : COLORS.open;
          break;
        case "ready_for_review":
          title = "Pull request ready for review";
          color = COLORS.open;
          break;
        case "reopened":
          title = "Pull request reopened";
          color = COLORS.open;
          break;
        case "closed":
          open = false;
          title = pr.merged ? "Pull request merged" : "Pull request closed";
          color = pr.merged ? COLORS.merged : COLORS.closed;
          break;
        default:
          return null;
      }
      const body = p.action === "opened" ? excerpt(pr.body) : undefined;
      return {
        feature: "pulls",
        content: "",
        embeds: [{ title: `[${repo}] ${title}: #${pr.number} ${pr.title}`, url: pr.html_url, description: body, color, author }],
        // A merged pull request can't be reopened.
        components: pr.merged ? undefined : issueButtons(p, "pull", pr.number, open),
      };
    }

    case "pull_request_review": {
      const pr = p.pull_request;
      const review = p.review;
      if (p.action !== "submitted" || !pr || !review) return null;
      const state = String(review.state ?? "").toLowerCase();
      const label = state === "approved" ? "approved" : state === "changes_requested" ? "requested changes on" : state === "commented" ? "reviewed" : null;
      if (!label) return null;
      // A bare "commented" review is usually just the container for line comments.
      if (state === "commented" && !excerpt(review.body)) return null;
      return {
        feature: "reviews",
        content: "",
        embeds: [
          {
            title: `[${repo}] ${p.sender?.login ?? "Someone"} ${label} #${pr.number} ${pr.title}`,
            url: review.html_url ?? pr.html_url,
            description: excerpt(review.body),
            color: state === "approved" ? COLORS.approved : state === "changes_requested" ? COLORS.changes : COLORS.neutral,
            author,
          },
        ],
      };
    }

    case "pull_request_review_comment": {
      const pr = p.pull_request;
      const comment = p.comment;
      if (p.action !== "created" || !pr || !comment) return null;
      return { feature: "comments", content: "", embeds: [{ title: `[${repo}] New review comment on #${pr.number}: ${pr.title}`, url: comment.html_url, description: excerpt(comment.body), color: COLORS.draft, author }] };
    }

    case "issues": {
      const issue = p.issue;
      if (!issue) return null;
      const titles: Record<string, [string, number, boolean]> = {
        opened: ["Issue opened", COLORS.open, true],
        reopened: ["Issue reopened", COLORS.open, true],
        closed: [issue.state_reason === "not_planned" ? "Issue closed as not planned" : "Issue closed", issue.state_reason === "not_planned" ? COLORS.draft : COLORS.merged, false],
      };
      const entry = titles[p.action as string];
      if (!entry) return null;
      const [title, color, open] = entry;
      return {
        feature: "issues",
        content: "",
        embeds: [{ title: `[${repo}] ${title}: #${issue.number} ${issue.title}`, url: issue.html_url, description: p.action === "opened" ? excerpt(issue.body) : undefined, color, author }],
        components: issueButtons(p, "issue", issue.number, open),
      };
    }

    case "issue_comment": {
      const issue = p.issue;
      const comment = p.comment;
      if (p.action !== "created" || !issue || !comment) return null;
      const on = issue.pull_request ? "pull request" : "issue";
      return { feature: "comments", content: "", embeds: [{ title: `[${repo}] New comment on ${on} #${issue.number}: ${issue.title}`, url: comment.html_url, description: excerpt(comment.body), color: COLORS.draft, author }] };
    }

    case "commit_comment": {
      const comment = p.comment;
      if (p.action !== "created" || !comment) return null;
      return { feature: "comments", content: "", embeds: [{ title: `[${repo}] New comment on commit ${String(comment.commit_id ?? "").slice(0, 7)}`, url: comment.html_url, description: excerpt(comment.body), color: COLORS.draft, author }] };
    }

    case "release": {
      const release = p.release;
      if (p.action !== "published" || !release) return null;
      const name = release.name && release.name !== release.tag_name ? `${release.tag_name}: ${release.name}` : release.tag_name;
      return { feature: "releases", content: "", embeds: [{ title: `[${repo}] ${release.prerelease ? "Pre-release" : "Release"} published: ${name}`, url: release.html_url, description: excerpt(release.body, 800), color: COLORS.neutral, author }] };
    }

    case "workflow_run": {
      const run = p.workflow_run;
      if (p.action !== "completed" || !run) return null;
      if (!["failure", "timed_out", "startup_failure"].includes(run.conclusion)) return null;
      const what = run.conclusion === "timed_out" ? "timed out" : "failed";
      return {
        feature: "workflows",
        content: "",
        embeds: [
          {
            title: `[${repo}] ${run.name} ${what} on ${run.head_branch}`,
            url: run.html_url,
            description: run.head_commit?.message ? `${escapeMarkdown(firstLine(run.head_commit.message, 120))}` : undefined,
            color: COLORS.closed,
            author,
            footer: { text: `${run.event ?? "run"} · attempt ${run.run_attempt ?? 1}` },
          },
        ],
      };
    }

    case "star": {
      if (p.action !== "created") return null;
      return { feature: "stars", content: "", embeds: [{ title: `[${repo}] New star added`, url: p.repository?.html_url, color: COLORS.draft, author, footer: { text: `${p.repository?.stargazers_count ?? 0} stars` } }] };
    }

    case "fork": {
      return { feature: "stars", content: "", embeds: [{ title: `[${repo}] Fork created: ${p.forkee?.full_name ?? ""}`, url: p.forkee?.html_url, color: COLORS.draft, author }] };
    }

    default:
      return null;
  }
}
