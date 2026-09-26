import { memo, useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import type { CustomEmoji } from "@shared/types";
import { CUSTOM_EMOJI_URL_PREFIX, expandShortcodes } from "@/lib/emoji";
import { remarkMentions, type MentionContext } from "@/lib/mentions";

/**
 * Lightweight, safe Markdown. react-markdown never renders raw HTML; we
 * further restrict the element set and only allow http(s)/mailto links plus
 * same-origin custom-emoji images.
 */
const ALLOWED = ["p", "br", "strong", "em", "del", "code", "pre", "a", "blockquote", "ul", "ol", "li", "text", "img", "span"];

const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow ugc">
      {children}
    </a>
  ),
  h1: ({ children }) => <p>{children}</p>,
  h2: ({ children }) => <p>{children}</p>,
  h3: ({ children }) => <p>{children}</p>,
  h4: ({ children }) => <p>{children}</p>,
  h5: ({ children }) => <p>{children}</p>,
  h6: ({ children }) => <p>{children}</p>,
  // Only workspace custom emojis render as images; any other image becomes a plain link.
  img: ({ src, alt }) => {
    if (typeof src === "string" && src.startsWith(CUSTOM_EMOJI_URL_PREFIX) && alt && /^:[a-z0-9_]+:$/.test(alt)) {
      return <img src={src} alt={alt} title={alt} className="emoji" loading="lazy" draggable={false} />;
    }
    return typeof src === "string" ? (
      <a href={src} target="_blank" rel="noopener noreferrer nofollow ugc">
        {alt || src}
      </a>
    ) : null;
  },
  hr: () => null,
  table: ({ children }) => <div className="overflow-x-auto text-xs">{children}</div>,
  input: () => null,
};

function urlTransform(url: string): string {
  const trimmed = url.trim();
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith(CUSTOM_EMOJI_URL_PREFIX) && !trimmed.includes("..")) return trimmed;
  return "";
}

const EMPTY = new Map<string, CustomEmoji>();

export const Markdown = memo(function Markdown({ content, emojis = EMPTY, mentions }: { content: string; emojis?: Map<string, CustomEmoji>; mentions?: MentionContext }) {
  const expanded = useMemo(() => expandShortcodes(content, emojis), [content, emojis]);
  // A message made only of emoji renders larger, like most chat apps.
  const jumbo = useMemo(() => isEmojiOnly(expanded), [expanded]);
  const plugins = useMemo(() => (mentions ? [remarkGfm, remarkBreaks, remarkMentions(mentions)] : [remarkGfm, remarkBreaks]), [mentions]);
  return (
    <div className={jumbo ? "jumbo-emoji" : undefined}>
      <ReactMarkdown
        remarkPlugins={plugins}
        allowedElements={[...ALLOWED, "h1", "h2", "h3", "h4", "h5", "h6", "hr", "table", "thead", "tbody", "tr", "th", "td", "input"]}
        unwrapDisallowed
        skipHtml
        urlTransform={urlTransform}
        components={components}
      >
        {expanded}
      </ReactMarkdown>
    </div>
  );
});

function isEmojiOnly(text: string): boolean {
  const stripped = text.replace(/!\[:[a-z0-9_]+:\]\([^)]+\)/g, "").replace(/\s/g, "");
  if (stripped.length === 0) return (text.match(/!\[:/g) ?? []).length <= 8 && text.trim().length > 0;
  if (stripped.length > 32) return false;
  return /^(\p{Extended_Pictographic}|\p{Emoji_Modifier}|‍|️)+$/u.test(stripped);
}
