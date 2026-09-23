import { useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import { searchEmoji, type EmojiEntry } from "@/lib/emoji";
import type { CustomEmoji } from "@shared/types";
import { EmojiGlyph } from "./EmojiGlyph";

export interface ShortcodeMatch {
  /** Index of the leading colon in the text. */
  start: number;
  /** Caret position (end of the partial shortcode). */
  end: number;
  query: string;
}

/**
 * Finds a partial `:shortcode` immediately before the caret. Requires at least
 * two characters after the colon so `:` alone (e.g. "10:30") never triggers.
 */
export function findShortcodeAtCaret(text: string, caret: number): ShortcodeMatch | null {
  const before = text.slice(0, caret);
  const m = /(^|[\s(])(:([a-z0-9_+-]{2,32}))$/i.exec(before);
  if (!m) return null;
  const start = caret - m[2]!.length;
  return { start, end: caret, query: m[3]!.toLowerCase() };
}

export function EmojiAutocomplete({
  match,
  customEmojis,
  selected,
  onSelectedChange,
  onPick,
}: {
  match: ShortcodeMatch;
  customEmojis: CustomEmoji[];
  selected: number;
  onSelectedChange: (i: number) => void;
  onPick: (entry: EmojiEntry) => void;
}) {
  const results = useMemo(() => searchEmoji(match.query, customEmojis, 10), [match.query, customEmojis]);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const el = listRef.current?.children[selected] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (results.length === 0) return null;
  return (
    <div className="absolute bottom-full left-0 z-20 mb-1 w-80 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md" role="listbox" aria-label="Emoji suggestions" id="emoji-autocomplete">
      <p className="border-b px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Emoji matching <span className="font-mono normal-case text-foreground">:{match.query}</span>
      </p>
      <ul ref={listRef} className="max-h-64 overflow-y-auto p-1">
        {results.map((e, i) => (
          <li
            key={`${e.group}-${e.name}`}
            role="option"
            aria-selected={i === selected}
            id={`emoji-option-${i}`}
            onMouseEnter={() => onSelectedChange(i)}
            onMouseDown={(ev) => {
              ev.preventDefault();
              onPick(e);
            }}
            className={cn("flex cursor-pointer items-center gap-2.5 rounded px-2 py-1.5 text-sm", i === selected && "bg-accent text-accent-foreground")}
          >
            <EmojiGlyph entry={e} className="size-5 text-lg" />
            <span className="min-w-0 flex-1 truncate font-mono text-[13px]">:{e.name}:</span>
            {e.custom ? <span className="text-[10px] uppercase tracking-wide text-muted-foreground">custom</span> : null}
          </li>
        ))}
      </ul>
      <p className="border-t px-2.5 py-1 text-[10px] text-muted-foreground">
        <kbd className="rounded border px-1 font-mono">↑↓</kbd> navigate · <kbd className="rounded border px-1 font-mono">Tab</kbd>/<kbd className="rounded border px-1 font-mono">Enter</kbd> insert · <kbd className="rounded border px-1 font-mono">Esc</kbd> dismiss
      </p>
    </div>
  );
}

export function useAutocompleteResults(match: ShortcodeMatch | null, customEmojis: CustomEmoji[]): EmojiEntry[] {
  return useMemo(() => (match ? searchEmoji(match.query, customEmojis, 10) : []), [match, customEmojis]);
}
