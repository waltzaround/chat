import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { STANDARD_EMOJI, customEntries, searchEmoji, type EmojiEntry } from "@/lib/emoji";
import type { CustomEmoji } from "@shared/types";
import { EmojiGlyph } from "./EmojiGlyph";

/**
 * Picks a standard emoji (returns the unicode character) or a workspace custom
 * emoji (returns its `:name:` shortcode).
 */
export function EmojiPicker({ onPick, customEmojis = [] }: { onPick: (value: string) => void; customEmojis?: CustomEmoji[] }) {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => {
    const q = query.trim();
    if (q) return [{ name: "Results", entries: searchEmoji(q, customEmojis, 64) }];
    const out: { name: string; entries: EmojiEntry[] }[] = [];
    if (customEmojis.length) out.push({ name: "Custom", entries: customEntries(customEmojis) });
    const byGroup = new Map<string, EmojiEntry[]>();
    for (const e of STANDARD_EMOJI) byGroup.set(e.group, [...(byGroup.get(e.group) ?? []), e]);
    for (const [name, entries] of byGroup) out.push({ name, entries });
    return out;
  }, [query, customEmojis]);

  const pick = (e: EmojiEntry) => onPick(e.custom ? `:${e.name}:` : e.char!);

  return (
    <div className="w-72 p-2" role="dialog" aria-label="Emoji picker">
      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search emoji" className="mb-2 h-8" autoFocus aria-label="Search emoji" />
      <div className="max-h-56 overflow-y-auto">
        {groups.map((g) => (
          <div key={g.name} className="mb-2">
            <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{g.name}</p>
            <div className="grid grid-cols-8 gap-0.5">
              {g.entries.map((e) => (
                <button
                  key={`${e.group}-${e.name}`}
                  type="button"
                  onClick={() => pick(e)}
                  aria-label={e.name.replace(/_/g, " ")}
                  title={`:${e.name}:`}
                  className="flex size-8 items-center justify-center rounded text-lg hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <EmojiGlyph entry={e} className="size-5" />
                </button>
              ))}
            </div>
            {g.entries.length === 0 ? <p className="px-1 py-2 text-xs text-muted-foreground">No matches</p> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
