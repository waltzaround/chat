import { cn } from "@/lib/utils";
import type { PresenceStatus } from "@shared/types";

export const STATUS_LABEL: Record<PresenceStatus | "invisible", string> = {
  online: "Online",
  idle: "Idle",
  dnd: "Do not disturb",
  offline: "Offline",
  invisible: "Invisible",
};

export function StatusDot({ status, className }: { status: PresenceStatus; className?: string }) {
  return (
    <span
      role="img"
      aria-label={STATUS_LABEL[status]}
      className={cn(
        "inline-block size-2.5 rounded-full",
        status === "online" && "bg-success",
        status === "idle" && "bg-warning",
        status === "dnd" && "bg-destructive",
        status === "offline" && "bg-muted-foreground/50",
        className,
      )}
    />
  );
}
