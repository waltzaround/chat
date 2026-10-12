/**
 * Incoming webhook payloads in the formats other tools already speak: Discord's and
 * Slack's. Both become the same message: text, an optional name and avatar, and cards.
 */
import { MESSAGE_MAX_LENGTH } from "@shared/schemas";

/* eslint-disable @typescript-eslint/no-explicit-any -- payloads come from other tools. */
type Json = any;

export interface IncomingMessage {
  content: string;
  username?: string;
  avatarUrl?: string;
  /** Loose cards; normalizeEmbeds() checks them. */
  embeds: unknown[];
  /** False when the sender asked for no pings (Discord allowed_mentions with an empty parse list). */
  allowMentions: boolean;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);

/** Discord's execute-webhook body: content, username, avatar_url, embeds, allowed_mentions. */
export function fromDiscord(body: Json): IncomingMessage {
  const allowed = body?.allowed_mentions;
  const allowMentions = !(allowed && typeof allowed === "object" && Array.isArray(allowed.parse) && allowed.parse.length === 0 && !allowed.users?.length);
  return {
    content: (str(body?.content) ?? "").slice(0, MESSAGE_MAX_LENGTH),
    username: str(body?.username)?.slice(0, 80),
    avatarUrl: str(body?.avatar_url),
    embeds: Array.isArray(body?.embeds) ? body.embeds : [],
    allowMentions,
  };
}

/** Slack's mrkdwn as Markdown: links, bold, strikethrough, and escaped characters. */
export function slackToMarkdown(text: string): string {
  return text
    .replace(/<!(channel|everyone)>/g, "@everyone")
    .replace(/<!here>/g, "@here")
    .replace(/<((?:https?|mailto):[^|>]+)\|([^>]+)>/g, (_, url: string, label: string) => `[${label}](${url})`)
    .replace(/<((?:https?|mailto):[^>]+)>/g, "$1")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?:;])/g, "$1**$2**")
    .replace(/(^|[\s(])~([^~\n]+)~(?=$|[\s).,!?:;])/g, "$1~~$2~~")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

const SLACK_COLORS: Record<string, number> = { good: 0x2eb67d, warning: 0xecb22e, danger: 0xe01e5a };

function slackColor(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  if (SLACK_COLORS[value]) return SLACK_COLORS[value];
  return /^#?[0-9a-f]{6}$/i.test(value) ? parseInt(value.replace("#", ""), 16) : undefined;
}

/** Text from Slack Block Kit: sections, headers, context and field blocks. */
function blocksToText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  const out: string[] = [];
  for (const block of blocks as Json[]) {
    if (block?.type === "header" && block.text?.text) out.push(`**${block.text.text}**`);
    else if (block?.type === "section") {
      if (block.text?.text) out.push(slackToMarkdown(block.text.text));
      if (Array.isArray(block.fields)) out.push(block.fields.map((f: Json) => slackToMarkdown(String(f?.text ?? ""))).filter(Boolean).join("\n"));
    } else if (block?.type === "context" && Array.isArray(block.elements)) {
      const text = block.elements.map((e: Json) => (e?.text ? slackToMarkdown(String(e.text)) : "")).filter(Boolean).join(" · ");
      if (text) out.push(text);
    }
  }
  return out.filter(Boolean).join("\n\n");
}

/** Slack's incoming webhook body: text, blocks, attachments, username, icon_url. */
export function fromSlack(body: Json): IncomingMessage {
  const text = str(body?.text) ? slackToMarkdown(body.text) : blocksToText(body?.blocks);
  const embeds: unknown[] = [];
  for (const a of Array.isArray(body?.attachments) ? (body.attachments as Json[]) : []) {
    const description = [str(a?.pretext) ? slackToMarkdown(a.pretext) : "", str(a?.text) ? slackToMarkdown(a.text) : "", blocksToText(a?.blocks)].filter(Boolean).join("\n\n");
    embeds.push({
      title: str(a?.title),
      url: str(a?.title_link),
      description: description || str(a?.fallback),
      color: slackColor(a?.color),
      author: str(a?.author_name) ? { name: a.author_name, url: a.author_link, icon_url: a.author_icon } : undefined,
      footer: str(a?.footer) ? { text: a.footer, icon_url: a.footer_icon } : undefined,
      timestamp: typeof a?.ts === "number" || /^\d+$/.test(String(a?.ts ?? "")) ? new Date(Number(a.ts) * 1000).toISOString() : undefined,
      fields: Array.isArray(a?.fields) ? a.fields.map((f: Json) => ({ name: f?.title, value: typeof f?.value === "string" ? slackToMarkdown(f.value) : f?.value, inline: !!f?.short })) : undefined,
      image: str(a?.image_url) ? { url: a.image_url } : undefined,
      thumbnail: str(a?.thumb_url) ? { url: a.thumb_url } : undefined,
    });
  }
  return {
    content: text.slice(0, MESSAGE_MAX_LENGTH),
    username: str(body?.username)?.slice(0, 80),
    avatarUrl: str(body?.icon_url),
    embeds,
    allowMentions: true,
  };
}
