import { useEffect, useMemo, useRef } from "react";
import { SquareSlash } from "lucide-react";
import type { AvailableCommand } from "@shared/types";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/common/UserAvatar";

/** "/dep" at the very start of the draft, before any space: what's typed so far. */
export function commandQueryOf(text: string): string | null {
  const m = /^\/([a-z0-9_-]{0,32})$/i.exec(text);
  return m ? m[1]!.toLowerCase() : null;
}

/** "/deploy production" as a command name and its text, or null. */
export function parseCommand(text: string): { name: string; text: string } | null {
  const m = /^\/([a-z0-9_-]{1,32})(?:\s+([\s\S]*))?$/i.exec(text.trim());
  return m ? { name: m[1]!.toLowerCase(), text: (m[2] ?? "").trim() } : null;
}

export function useCommandSuggestions(query: string | null, commands: AvailableCommand[] | undefined): AvailableCommand[] {
  return useMemo(() => {
    if (query === null || !commands) return [];
    return commands
      .filter((c) => c.name.startsWith(query))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 10);
  }, [query, commands]);
}

export function CommandAutocomplete({ options, selected, onSelectedChange, onPick }: { options: AvailableCommand[]; selected: number; onSelectedChange: (i: number) => void; onPick: (c: AvailableCommand) => void }) {
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    (listRef.current?.children[selected] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  return (
    <div className="absolute bottom-full left-0 z-20 mb-1 w-[26rem] max-w-full overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md" role="listbox" aria-label="Commands" id="command-autocomplete">
      <p className="border-b px-2.5 py-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Commands</p>
      <ul ref={listRef} className="max-h-72 overflow-y-auto p-1">
        {options.map((c, i) => (
          <li
            key={`${c.bot?.id ?? "built-in"}:${c.name}`}
            role="option"
            aria-selected={i === selected}
            id={`command-option-${i}`}
            onMouseEnter={() => onSelectedChange(i)}
            onMouseDown={(ev) => {
              ev.preventDefault();
              onPick(c);
            }}
            className={cn("flex cursor-pointer items-center gap-2.5 rounded px-2 py-1.5 text-sm", i === selected && "bg-accent text-accent-foreground")}
          >
            {c.bot ? (
              <UserAvatar user={c.bot} size="sm" />
            ) : (
              <span className="flex size-6 items-center justify-center rounded-full bg-muted">
                <SquareSlash className="size-3.5" aria-hidden />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate">
                <span className="font-medium">/{c.name}</span>
                {c.usage ? <span className="text-muted-foreground"> {c.usage}</span> : null}
              </span>
              <span className="block truncate text-xs text-muted-foreground">{c.description}</span>
            </span>
            <span className="shrink-0 truncate text-xs text-muted-foreground">{c.bot?.displayName ?? "Built in"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
