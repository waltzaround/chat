import { useState } from "react";
import { NavLink, useNavigate } from "react-router";
import { Loader2, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { UserAvatar } from "@/components/common/UserAvatar";
import { MentionBadge } from "@/components/common/MentionBadge";
import { UserPanel } from "@/components/channels/UserPanel";
import { useCloseDm, useDmPeople, useDms, useOpenDm } from "@/lib/queries";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Left panel for direct messages: your conversations, newest first. */
export function DirectMessagesSidebar({ activeWorkspaceId, onNavigate }: { activeWorkspaceId?: string; onNavigate?: () => void }) {
  const dms = useDms();
  const [newOpen, setNewOpen] = useState(false);
  const close = useCloseDm();
  const navigate = useNavigate();

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar" aria-label="Direct messages">
      <div className="flex h-12 items-center justify-between border-b px-3">
        <h2 className="text-sm font-semibold">Direct messages</h2>
        <Button type="button" variant="ghost" size="icon" className="size-7" aria-label="New message" onClick={() => setNewOpen(true)}>
          <Plus className="size-4" aria-hidden />
        </Button>
      </div>
      <nav className="flex-1 overflow-y-auto p-2">
        {dms.isPending ? (
          <Loader2 className="mx-auto mt-4 size-4 animate-spin text-muted-foreground" aria-label="Loading conversations" />
        ) : dms.data?.length ? (
          <ul className="grid gap-0.5">
            {dms.data.map((dm) => {
              const active = dm.workspaceId === activeWorkspaceId;
              return (
                <li key={dm.workspaceId} className="group/dm relative">
                  <NavLink
                    to={`/w/${dm.workspaceId}/c/${dm.channelId}`}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex h-10 items-center gap-2.5 rounded-md px-2 text-sm transition-colors",
                      active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent/60",
                      !active && dm.unreadCount > 0 && "font-semibold text-foreground",
                    )}
                  >
                    <UserAvatar user={dm.peer} size="sm" />
                    <span className="min-w-0 flex-1 truncate">{dm.peer.displayName}</span>
                    {!active ? <MentionBadge count={dm.unreadCount} noun="message" className="group-hover/dm:hidden" /> : null}
                  </NavLink>
                  <button
                    type="button"
                    aria-label={`Close conversation with ${dm.peer.displayName}`}
                    onClick={() => close.mutate(dm.workspaceId, { onSuccess: () => active && navigate("/dms") })}
                    className="absolute top-1/2 right-1.5 hidden size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:flex group-hover/dm:flex"
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="grid gap-2 p-2 text-center text-sm text-muted-foreground">
            <p>No conversations yet.</p>
            <Button type="button" size="sm" variant="outline" onClick={() => setNewOpen(true)}>
              Start one
            </Button>
          </div>
        )}
      </nav>
      <UserPanel />
      <NewMessageDialog open={newOpen} onOpenChange={setNewOpen} onNavigate={onNavigate} />
    </aside>
  );
}

/** Pick someone you share a workspace with and open your conversation. */
export function NewMessageDialog({ open, onOpenChange, onNavigate }: { open: boolean; onOpenChange: (open: boolean) => void; onNavigate?: () => void }) {
  const [q, setQ] = useState("");
  const people = useDmPeople(q.trim(), open);
  const openDm = useOpenDm();
  const navigate = useNavigate();

  const pick = (userId: string) =>
    openDm.mutate(userId, {
      onSuccess: (dm) => {
        onOpenChange(false);
        setQ("");
        onNavigate?.();
        navigate(`/w/${dm.workspaceId}/c/${dm.channelId}`);
      },
      onError: (err) => toast.error(errorMessage(err)),
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New message</DialogTitle>
          <DialogDescription>You can message anyone you share a workspace with.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or username" aria-label="Search people" className="pl-8" autoFocus />
        </div>
        <ul className="max-h-72 overflow-y-auto">
          {people.data?.length ? (
            people.data.map((u) => (
              <li key={u.id}>
                <button type="button" onClick={() => pick(u.id)} disabled={openDm.isPending} className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm hover:bg-accent">
                  <UserAvatar user={u} size="sm" />
                  <span className="min-w-0 flex-1 truncate">{u.displayName}</span>
                  <span className="truncate text-xs text-muted-foreground">@{u.username}</span>
                </button>
              </li>
            ))
          ) : (
            <li className="p-3 text-center text-sm text-muted-foreground">{people.isPending ? "Searching…" : "Nobody found."}</li>
          )}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
