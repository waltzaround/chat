/**
 * Preview cards for links in messages. A background job fetches each page once, reads
 * its Open Graph tags, and stores the cards on the message. Wrapping a link in <> in
 * the message skips its preview, as in Discord.
 */
import { and, eq, isNull } from "drizzle-orm";
import type { Embed } from "@shared/types";
import type { Env } from "../env";
import { schema, type Db } from "../db";
import { loadMessage } from "../lib/messages";
import { notifyWorkspace } from "../lib/hub";
import { getSetting } from "../instance";
import { httpUrl, normalizeEmbeds } from "./embeds";
import { githubLinkPreview } from "./github-links";
import type { Fetcher } from "./bot-events";

export const MAX_PREVIEWS = 3;
const FETCH_TIMEOUT_MS = 5_000;
const MAX_HTML_BYTES = 512 * 1024;

/** http(s) links outside code, not wrapped in <>, in order, without repeats. */
export function extractLinks(content: string): string[] {
  const text = content.replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " ");
  const found: string[] = [];
  for (const match of text.matchAll(/(<)?(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"\]])(>)?/gi)) {
    if (match[1] && match[3]) continue;
    const url = httpUrl(match[2]);
    if (url && !found.includes(url)) found.push(url);
    if (found.length >= MAX_PREVIEWS) break;
  }
  return found;
}

export function hasPreviewableLinks(content: string): boolean {
  return /https?:\/\//i.test(content) && extractLinks(content).length > 0;
}

/** The server owner can turn previews off in Server settings. */
export async function linkPreviewsEnabled(db: D1Database): Promise<boolean> {
  return (await getSetting(db, "link_previews")) !== "off";
}

interface PageMeta {
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  themeColor?: string;
  largeImage: boolean;
  documentTitle: string;
}

/** Reads Open Graph and Twitter card tags from an HTML page with HTMLRewriter. */
async function readPageMeta(res: Response): Promise<PageMeta> {
  const meta: PageMeta = { largeImage: false, documentTitle: "" };
  const tags = new Map<string, string>();
  let inTitle = false;
  const rewriter = new HTMLRewriter()
    .on("meta", {
      element(el) {
        const key = (el.getAttribute("property") ?? el.getAttribute("name") ?? "").toLowerCase();
        const value = el.getAttribute("content");
        if (key && value && !tags.has(key)) tags.set(key, value);
      },
    })
    .on("title", {
      element(el) {
        inTitle = true;
        el.onEndTag(() => {
          inTitle = false;
        });
      },
      text(chunk) {
        if (inTitle && meta.documentTitle.length < 300) meta.documentTitle += chunk.text;
      },
    });

  let seen = 0;
  const limited = res.body!.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > MAX_HTML_BYTES) controller.terminate();
        else controller.enqueue(chunk);
      },
    }),
  );
  await rewriter.transform(new Response(limited, { headers: res.headers })).arrayBuffer();

  meta.title = tags.get("og:title") ?? tags.get("twitter:title");
  meta.description = tags.get("og:description") ?? tags.get("twitter:description") ?? tags.get("description");
  meta.image = tags.get("og:image") ?? tags.get("og:image:url") ?? tags.get("twitter:image");
  meta.siteName = tags.get("og:site_name");
  meta.themeColor = tags.get("theme-color");
  meta.largeImage = tags.get("twitter:card") === "summary_large_image";
  meta.documentTitle = decodeEntities(meta.documentTitle.trim());
  return meta;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));
}

/** One link's card, or null when the page has nothing worth showing. */
export async function previewFor(env: Env, url: string, fetcher: Fetcher = fetch): Promise<Embed | null> {
  const github = await githubLinkPreview(env, url, fetcher).catch(() => null);
  if (github) return github;

  let res: Response;
  try {
    res = await fetcher(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ChatLinkPreview/1.0; +https://github.com/waltzaround/chat)", Accept: "text/html,application/xhtml+xml,image/*;q=0.8" },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cf: { cacheTtl: 3600, cacheEverything: true },
    } as RequestInit);
  } catch {
    return null;
  }
  const type = (res.headers.get("content-type") ?? "").toLowerCase();
  if (!res.ok || !res.body) {
    await res.body?.cancel();
    return null;
  }
  const host = new URL(res.url || url).hostname.replace(/^www\./, "");
  if (type.startsWith("image/") && !type.includes("svg")) {
    await res.body.cancel();
    const [card] = await normalizeEmbeds(env, [{ url, image: { url }, provider: { name: host } }], "link");
    return card ?? null;
  }
  if (!type.includes("text/html") && !type.includes("application/xhtml")) {
    await res.body.cancel();
    return null;
  }
  const meta = await readPageMeta(res);
  const title = meta.title ?? meta.documentTitle;
  if (!title && !meta.description) return null;
  const image = meta.image ? new URL(meta.image, res.url || url).toString() : undefined;
  const color = meta.themeColor && /^#[0-9a-f]{6}$/i.test(meta.themeColor.trim()) ? parseInt(meta.themeColor.trim().slice(1), 16) : undefined;
  const [card] = await normalizeEmbeds(
    env,
    [
      {
        url,
        title: title ? decodeEntities(title).slice(0, 256) : undefined,
        description: meta.description ? decodeEntities(meta.description).slice(0, 350) : undefined,
        color,
        provider: { name: meta.siteName ? decodeEntities(meta.siteName) : host },
        ...(image ? (meta.largeImage ? { image: { url: image } } : { thumbnail: { url: image } }) : {}),
      },
    ],
    "link",
  );
  return card ?? null;
}

/** Background job: previews for a new or edited message's links. */
export async function buildLinkPreviews(env: Env, db: Db, messageId: string, fetcher: Fetcher = fetch): Promise<void> {
  if (!(await linkPreviewsEnabled(env.DB))) return;
  const row = await db.query.messages.findFirst({ where: and(eq(schema.messages.id, messageId), isNull(schema.messages.deletedAt)) });
  if (!row || row.embeds?.length) return;
  const links = extractLinks(row.content);
  const cards = (await Promise.all(links.map((url) => previewFor(env, url, fetcher)))).filter((c): c is Embed => !!c);
  if (cards.length === 0 && !row.linkEmbeds?.length) return;
  await db.update(schema.messages).set({ linkEmbeds: cards.length ? cards : null }).where(eq(schema.messages.id, row.id));
  const message = await loadMessage(db, row.id, row.authorUserId);
  if (message) await notifyWorkspace(env, row.workspaceId, { type: "message.updated", message }, row.channelId);
}
