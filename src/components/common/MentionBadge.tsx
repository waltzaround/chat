import { cn } from "@/lib/utils";

/** Red count of unread mentions, as on a channel or workspace icon. */
export function MentionBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  const label = count > 99 ? "99+" : String(count);
  return (
    <span
      className={cn("inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-none text-white", className)}
      aria-label={`${count} unread ${count === 1 ? "mention" : "mentions"}`}
    >
      {label}
    </span>
  );
}
