/**
 * Rich cards and buttons from webhooks, bots and link previews: validation, limits,
 * and proxying images through this server so readers' addresses aren't shared with
 * whatever site an image URL points at.
 */
import type { ActionRow, ButtonComponent, ButtonStyle, Embed } from "@shared/types";
import type { Env } from "../env";
import { authSecret } from "../instance";
import { base64Url, hmacSha256, timingSafeEqual } from "../lib/crypto";

export const EMBED_LIMITS = {
  embeds: 10,
  title: 256,
  description: 4096,
  fields: 25,
  fieldName: 256,
  fieldValue: 1024,
  footer: 2048,
  authorName: 256,
  /** Characters across every card on one message. */
  total: 6000,
} as const;

export const COMPONENT_LIMITS = { rows: 5, buttons: 5, label: 80, customId: 100 } as const;

type Loose = Record<string, unknown>;

const asObject = (v: unknown): Loose | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Loose) : null);
const asString = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);
/** Accepts our camelCase names and Discord's snake_case ones. */
const pick = (o: Loose, camel: string, snake?: string): unknown => o[camel] ?? (snake ? o[snake] : undefined);

export function httpUrl(v: unknown): string | undefined {
  const s = asString(v)?.trim();
  if (!s || s.length > 2048) return undefined;
  try {
    const url = new URL(s);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function clip(text: string | undefined, max: number, budget: { left: number }): string | undefined {
  if (!text) return undefined;
  const allowed = Math.max(0, Math.min(max, budget.left));
  if (allowed === 0) return undefined;
  const out = text.length > allowed ? `${text.slice(0, Math.max(0, allowed - 1))}…` : text;
  budget.left -= out.length;
  return out;
}

/**
 * Turns whatever a webhook or bot sent into cards we can store and show. Anything
 * invalid is dropped rather than refused, the way Discord-compatible tools expect.
 */
export async function normalizeEmbeds(env: Env, input: unknown, type: Embed["type"] = "rich"): Promise<Embed[]> {
  if (!Array.isArray(input)) return [];
  const budget = { left: EMBED_LIMITS.total };
  const out: Embed[] = [];
  for (const raw of input.slice(0, EMBED_LIMITS.embeds)) {
    const o = asObject(raw);
    if (!o) continue;
    const embed: Embed = { type };
    embed.title = clip(asString(o.title), EMBED_LIMITS.title, budget);
    embed.url = httpUrl(o.url);
    embed.description = clip(asString(o.description), EMBED_LIMITS.description, budget);
    const color = typeof o.color === "number" ? o.color : typeof o.color === "string" && /^#?[0-9a-f]{6}$/i.test(o.color) ? parseInt(o.color.replace("#", ""), 16) : undefined;
    if (color !== undefined && Number.isInteger(color) && color >= 0 && color <= 0xffffff) embed.color = color;
    const ts = asString(o.timestamp);
    if (ts && !Number.isNaN(Date.parse(ts))) embed.timestamp = new Date(ts).toISOString();

    const author = asObject(o.author);
    const authorName = author ? clip(asString(author.name), EMBED_LIMITS.authorName, budget) : undefined;
    if (author && authorName) {
      embed.author = { name: authorName };
      const url = httpUrl(author.url);
      if (url) embed.author.url = url;
      const icon = await proxiedImage(env, pick(author, "iconUrl", "icon_url"));
      if (icon) embed.author.iconUrl = icon;
    }
    const footer = asObject(o.footer);
    const footerText = footer ? clip(asString(footer.text), EMBED_LIMITS.footer, budget) : undefined;
    if (footer && footerText) {
      embed.footer = { text: footerText };
      const icon = await proxiedImage(env, pick(footer, "iconUrl", "icon_url"));
      if (icon) embed.footer.iconUrl = icon;
    }
    if (Array.isArray(o.fields)) {
      const fields: NonNullable<Embed["fields"]> = [];
      for (const f of o.fields.slice(0, EMBED_LIMITS.fields)) {
        const field = asObject(f);
        if (!field) continue;
        const name = clip(asString(field.name), EMBED_LIMITS.fieldName, budget);
        const value = clip(asString(field.value), EMBED_LIMITS.fieldValue, budget);
        if (!name || !value) continue;
        fields.push(field.inline === true ? { name, value, inline: true } : { name, value });
      }
      if (fields.length) embed.fields = fields;
    }
    const image = asObject(o.image);
    const imageUrl = image ? await proxiedImage(env, image.url) : undefined;
    if (image && imageUrl) {
      embed.image = { url: imageUrl };
      if (typeof image.width === "number" && typeof image.height === "number") Object.assign(embed.image, { width: image.width, height: image.height });
    }
    const thumbnail = asObject(o.thumbnail);
    const thumbUrl = thumbnail ? await proxiedImage(env, thumbnail.url) : undefined;
    if (thumbUrl) embed.thumbnail = { url: thumbUrl };
    const provider = asObject(o.provider);
    const providerName = provider ? asString(provider.name)?.slice(0, 256) : undefined;
    if (provider && providerName) embed.provider = httpUrl(provider.url) ? { name: providerName, url: httpUrl(provider.url)! } : { name: providerName };

    for (const key of Object.keys(embed) as (keyof Embed)[]) if (embed[key] === undefined) delete embed[key];
    // A card needs something to show.
    if (embed.title || embed.description || embed.fields || embed.image || embed.thumbnail || embed.author) out.push(embed);
  }
  return out;
}

const STYLES: ButtonStyle[] = ["primary", "secondary", "success", "danger", "link"];
/** Discord's numeric button styles. */
const DISCORD_STYLES: Record<number, ButtonStyle> = { 1: "primary", 2: "secondary", 3: "success", 4: "danger", 5: "link" };

/** Rows of buttons from a bot. Invalid buttons are dropped. */
export function normalizeComponents(input: unknown): ActionRow[] {
  if (!Array.isArray(input)) return [];
  const rows: ActionRow[] = [];
  for (const rawRow of input.slice(0, COMPONENT_LIMITS.rows)) {
    const row = asObject(rawRow);
    const list = row && Array.isArray(row.components) ? row.components : null;
    if (!list) continue;
    const buttons: ButtonComponent[] = [];
    for (const rawButton of list.slice(0, COMPONENT_LIMITS.buttons)) {
      const b = asObject(rawButton);
      if (!b) continue;
      const style = typeof b.style === "number" ? DISCORD_STYLES[b.style] : STYLES.find((s) => s === b.style) ?? "secondary";
      const label = asString(b.label)?.slice(0, COMPONENT_LIMITS.label);
      if (!style || !label) continue;
      const button: ButtonComponent = { type: "button", style, label };
      if (style === "link") {
        const url = httpUrl(b.url);
        if (!url) continue;
        button.url = url;
      } else {
        const customId = asString(pick(b, "customId", "custom_id"))?.slice(0, COMPONENT_LIMITS.customId);
        if (!customId) continue;
        button.customId = customId;
      }
      if (b.disabled === true) button.disabled = true;
      buttons.push(button);
    }
    if (buttons.length) rows.push({ type: "row", components: buttons });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Image proxy
// ---------------------------------------------------------------------------

async function mediaSignature(env: Env, url: string): Promise<string> {
  return base64Url(await hmacSha256(await authSecret(env), `media:${url}`)).slice(0, 22);
}

/** This server's own files pass through; outside http(s) images go through /api/media. */
export async function proxiedImage(env: Env, raw: unknown): Promise<string | undefined> {
  const value = asString(raw)?.trim();
  if (!value) return undefined;
  if (value.startsWith("/api/files/") && !value.includes("..")) return value;
  if (value.startsWith("/api/media?")) return value;
  const url = httpUrl(value);
  if (!url) return undefined;
  return `/api/media?u=${encodeURIComponent(url)}&s=${await mediaSignature(env, url)}`;
}

export async function verifyMediaSignature(env: Env, url: string, signature: string): Promise<boolean> {
  return timingSafeEqual(await mediaSignature(env, url), signature);
}
