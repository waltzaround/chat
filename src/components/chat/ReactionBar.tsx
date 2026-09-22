import { SmilePlus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReactionSummary } from "@shared/types";

export function ReactionBar({ reactions, onToggle, canReact, onAdd }: { reactions: ReactionSummary[]; onToggle: (emoji: string) => void; canReact: boolean; onAdd?: () => void }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1" role="group" aria-label="Reactions">
      {reactions.map((r) => (
        <button
          key={r.emoji}
          type="button"
          onClick={() => canReact && onToggle(r.emoji)}
          disabled={!canReact && !r.me}
          aria-pressed={r.me}
          aria-label={`${r.emoji} ${r.count}${r.me ? ", you reacted" : ""}`}
          className={cn(
            "flex h-6 items-center gap-1 rounded-md border px-1.5 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            r.me ? "border-primary/50 bg-primary/15 text-foreground" : "border-border bg-muted/40 text-muted-foreground hover:border-foreground/30 hover:bg-muted",
          )}
        >
          <span aria-hidden>{r.emoji}</span>
          <span className="tabular-nums">{r.count}</span>
        </button>
      ))}
      {onAdd ? (
        <button type="button" onClick={onAdd} aria-label="Add reaction" className="flex h-6 items-center rounded-md border border-transparent px-1.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          <SmilePlus className="size-3.5" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
