import { cn } from "@/lib/utils";

/** Red count of unread mentions (or, for direct messages, unread messages). */
export function MentionBadge({ count, className, noun = "mention" }: { count: number; className?: string; noun?: "mention" | "message" }) {
  if (count <= 0) return null;
  const label = count > 99 ? "99+" : String(count);
  return (
    <span
      className={cn("inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-none text-white", className)}
      aria-label={`${count} unread ${count === 1 ? noun : `${noun}s`}`}
    >
      {label}
    </span>
  );
}
