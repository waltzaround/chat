import type { ReactNode } from "react";
import { Hash, Menu, Search, Users, Volume2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLayout } from "@/app/layout-context";
import { cn } from "@/lib/utils";
import type { Channel, UserSummary } from "@shared/types";
import { UserAvatar } from "@/components/common/UserAvatar";

export function ChannelHeader({ channel, actions, dmPeer }: { channel: Channel; actions?: ReactNode; dmPeer?: UserSummary | null }) {
  const { viewport, membersOpen, toggleMembers, setNavOpen, setSearchOpen } = useLayout();
  const Icon = channel.kind === "voice" ? Volume2 : Hash;
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
      {viewport === "mobile" ? (
        <HeaderButton label="Open navigation" onClick={() => setNavOpen(true)}>
          <Menu className="size-5" aria-hidden />
        </HeaderButton>
      ) : null}
      {dmPeer ? <UserAvatar user={dmPeer} size="sm" /> : <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />}
      <h1 className="truncate text-[0.95rem] font-semibold">{dmPeer ? dmPeer.displayName : channel.name}</h1>
      {dmPeer ? <span className="truncate text-sm text-muted-foreground">@{dmPeer.username}</span> : null}
      {channel.topic ? (
        <>
          <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden />
          <p className="hidden min-w-0 flex-1 truncate text-sm text-muted-foreground md:block" title={channel.topic}>
            {channel.topic}
          </p>
        </>
      ) : (
        <span className="flex-1" />
      )}
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        {actions}
        <HeaderButton label="Search messages" onClick={() => setSearchOpen(true)} shortcut="Ctrl K">
          <Search className="size-[18px]" aria-hidden />
        </HeaderButton>
        {dmPeer === undefined ? (
          <HeaderButton label={membersOpen ? "Hide member list" : "Show member list"} onClick={toggleMembers} pressed={membersOpen}>
            <Users className="size-[18px]" aria-hidden />
          </HeaderButton>
        ) : null}
      </div>
    </header>
  );
}

export function HeaderButton({ label, onClick, children, pressed, shortcut }: { label: string; onClick: () => void; children: ReactNode; pressed?: boolean; shortcut?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          aria-pressed={pressed}
          className={cn(
            "flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            pressed && "text-foreground",
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {shortcut ? <span className="ml-2 text-muted-foreground">{shortcut}</span> : null}
      </TooltipContent>
    </Tooltip>
  );
}
