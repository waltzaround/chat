import { cn } from "@/lib/utils";
import { isCustomShortcode, shortcodeName, type EmojiEntry } from "@/lib/emoji";
import type { CustomEmoji } from "@shared/types";

/** Renders either a unicode emoji or a custom emoji image at a consistent size. */
export function EmojiGlyph({ entry, className }: { entry: EmojiEntry; className?: string }) {
  if (entry.custom && entry.url) {
    return <img src={entry.url} alt={`:${entry.name}:`} title={`:${entry.name}:`} className={cn("inline-block object-contain", className)} draggable={false} />;
  }
  return <span aria-hidden className={cn("inline-flex items-center justify-center leading-none", className)}>{entry.char}</span>;
}

/**
 * Renders a reaction/emoji value: a unicode character or a `:name:` shortcode
 * resolved against the workspace's custom emojis. Unknown shortcodes fall back
 * to the literal text so nothing silently disappears.
 */
export function ReactionGlyph({ value, emojis, className }: { value: string; emojis: Map<string, CustomEmoji>; className?: string }) {
  if (isCustomShortcode(value)) {
    const custom = emojis.get(shortcodeName(value));
    if (custom) return <img src={custom.url} alt={value} title={value} className={cn("inline-block object-contain", className)} draggable={false} />;
    return <span className={cn("font-mono text-[0.7em] text-muted-foreground", className)}>{value}</span>;
  }
  return <span aria-hidden className={cn("inline-flex items-center justify-center leading-none", className)}>{value}</span>;
}
