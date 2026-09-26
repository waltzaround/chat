import { useEffect, useMemo, useRef } from "react";
import { Megaphone, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/common/UserAvatar";
import type { Member } from "@shared/types";
import type { ShortcodeMatch } from "./EmojiAutocomplete";

export type MentionOption =
  | { kind: "member"; username: string; label: string; member: Member }
  | { kind: "wide"; username: "everyone" | "here"; label: string; description: string };

/** A partial `@name` right before the caret. `@` alone opens the list. */
export function findMentionAtCaret(text: string, caret: number): ShortcodeMatch | null {
  const before = text.slice(0, caret);
  const m = /(^|[\s(])(@([a-z0-9_.]{0,32}))$/i.exec(before);
  if (!m) return null;
  return { start: caret - m[2]!.length, end: caret, query: m[3]!.toLowerCase() };
}

export function useMentionSuggestions(match: ShortcodeMatch | null, members: Member[] | undefined, canMentionEveryone: boolean, meId: string | undefined): MentionOption[] {
  return useMemo(() => {
    if (!match) return [];
    const q = match.query;
    const people = (members ?? [])
      .filter((m) => m.userId !== meId)
      .map((m) => ({ m, label: m.nickname ?? m.displayName }))
      .filter(({ m, label }) => !q || m.username.toLowerCase().includes(q) || label.toLowerCase().includes(q))
      // Prefix matches first, then alphabetical.
      .sort((a, b) => Number(!a.m.username.toLowerCase().startsWith(q)) - Number(!b.m.username.toLowerCase().startsWith(q)) || a.label.localeCompare(b.label))
      .slice(0, 8)
      .map(({ m, label }): MentionOption => ({ kind: "member", username: m.username, label, member: m }));
    const wide: MentionOption[] = canMentionEveryone
      ? ([
          { kind: "wide", username: "everyone", label: "@everyone", description: "Everyone who can see this channel" },
          { kind: "wide", username: "here", label: "@here", description: "Everyone here right now" },
        ] as const).filter((o) => o.username.startsWith(q))
      : [];
    return [...people, ...wide];
  }, [match, members, canMentionEveryone, meId]);
}

export function MentionAutocomplete({ options, selected, onSelectedChange, onPick }: { options: MentionOption[]; selected: number; onSelectedChange: (i: number) => void; onPick: (o: MentionOption) => void }) {
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    (listRef.current?.children[selected] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return (
    <div className="absolute bottom-full left-0 z-20 mb-1 w-80 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md" role="listbox" aria-label="People to mention" id="mention-autocomplete">
      <p className="border-b px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Mention</p>
      <ul ref={listRef} className="max-h-64 overflow-y-auto p-1">
        {options.map((o, i) => (
          <li
            key={o.username}
            role="option"
            aria-selected={i === selected}
            id={`mention-option-${i}`}
            onMouseEnter={() => onSelectedChange(i)}
            onMouseDown={(ev) => {
              ev.preventDefault();
              onPick(o);
            }}
            className={cn("flex cursor-pointer items-center gap-2.5 rounded px-2 py-1.5 text-sm", i === selected && "bg-accent text-accent-foreground")}
          >
            {o.kind === "member" ? (
              <UserAvatar user={o.member} size="sm" />
            ) : (
              <span className="flex size-6 items-center justify-center rounded-full bg-muted">
                {o.username === "everyone" ? <Megaphone className="size-3.5" aria-hidden /> : <Users className="size-3.5" aria-hidden />}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate">{o.label}</span>
            <span className="truncate text-xs text-muted-foreground">{o.kind === "member" ? `@${o.username}` : o.description}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
