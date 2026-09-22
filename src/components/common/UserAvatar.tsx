import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { hueFor, initials } from "@/lib/format";
import type { PresenceStatus } from "@shared/types";
import { StatusDot } from "./StatusDot";

const sizes = {
  xs: "size-5 text-[9px]",
  sm: "size-6 text-[10px]",
  md: "size-8 text-xs",
  lg: "size-10 text-sm",
  xl: "size-20 text-2xl",
} as const;

export function UserAvatar({
  user,
  size = "md",
  status,
  className,
}: {
  user: { id: string; displayName: string; avatarUrl: string | null };
  size?: keyof typeof sizes;
  status?: PresenceStatus;
  className?: string;
}) {
  const hue = hueFor(user.id);
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <Avatar className={cn(sizes[size], "rounded-full")}>
        {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt="" /> : null}
        <AvatarFallback
          className="font-semibold text-white"
          style={{ background: `oklch(0.55 0.13 ${hue})` }}
          aria-hidden
        >
          {initials(user.displayName)}
        </AvatarFallback>
      </Avatar>
      {status ? <StatusDot status={status} className={cn("absolute -right-0.5 -bottom-0.5 ring-2 ring-sidebar", size === "xs" || size === "sm" ? "size-2" : size === "xl" ? "size-5" : "size-2.5")} /> : null}
    </span>
  );
}
