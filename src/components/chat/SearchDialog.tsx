import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { Hash, Loader2, Search, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLayout } from "@/app/layout-context";
import { useGlobalSearch, useMembers, useSearch, useWorkspace } from "@/lib/queries";
import { formatMessageTimestamp } from "@/lib/format";
import { memberDisplayName } from "@/lib/permissions";
import { UserAvatar } from "@/components/common/UserAvatar";

export function SearchDialog({ workspaceId }: { workspaceId: string }) {
  const { searchOpen, setSearchOpen } = useLayout();
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const [channelId, setChannelId] = useState("all");
  const [authorId, setAuthorId] = useState("all");
  const ws = useWorkspace(workspaceId);
  const members = useMembers(workspaceId);
  const navigate = useNavigate();
  const isDm = ws.data?.kind === "dm";
  const [scope, setScope] = useState<"here" | "everywhere">("here");
  const everywhere = scope === "everywhere";

  useEffect(() => {
    const t = setTimeout(() => setQ(input.trim()), 250);
    return () => clearTimeout(t);
  }, [input]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSearchOpen]);

  const here = useSearch(workspaceId, everywhere ? "" : q, { channelId: channelId === "all" ? undefined : channelId, authorId: authorId === "all" ? undefined : authorId });
  const all = useGlobalSearch(q, everywhere);
  const results = everywhere ? all : here;
  const textChannels = useMemo(() => (ws.data?.channels ?? []).filter((c) => c.kind === "text"), [ws.data]);

  const open = (message: { workspaceId: string; channelId: string; sequence: number; threadRootId: string | null }) => {
    setSearchOpen(false);
    // A thread reply isn't in the channel list: open its thread instead.
    navigate(`/w/${message.workspaceId}/c/${message.channelId}?${message.threadRootId ? `thread=${message.threadRootId}` : `m=${message.sequence}`}`);
  };

  return (
    <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
      <DialogContent className="top-[10%] max-w-2xl translate-y-0 gap-0 p-0 [&>button]:hidden" aria-describedby={undefined}>
        <DialogTitle className="sr-only">Search messages</DialogTitle>
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder={everywhere ? "Search everywhere" : isDm ? "Search this conversation" : `Search ${ws.data?.name ?? "workspace"}`} autoFocus aria-label="Search messages" className="h-12 border-0 bg-transparent px-0 text-base shadow-none focus-visible:ring-0" />
          {results.isFetching ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden /> : null}
          <button type="button" onClick={() => setSearchOpen(false)} aria-label="Close search" className="rounded p-1 text-muted-foreground hover:text-foreground">
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <div className="flex flex-wrap gap-2 border-b px-3 py-2">
          <Select value={scope} onValueChange={(v) => setScope(v as "here" | "everywhere")}>
            <SelectTrigger className="h-7 w-44 text-xs" aria-label="Where to search">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="here">{isDm ? "This conversation" : "This workspace"}</SelectItem>
              <SelectItem value="everywhere">Everywhere</SelectItem>
            </SelectContent>
          </Select>
          {everywhere || isDm ? null : (
          <Select value={channelId} onValueChange={setChannelId}>
            <SelectTrigger className="h-7 w-44 text-xs" aria-label="Filter by channel">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All channels</SelectItem>
              {textChannels.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  # {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          )}
          {everywhere ? null : (
          <Select value={authorId} onValueChange={setAuthorId}>
            <SelectTrigger className="h-7 w-44 text-xs" aria-label="Filter by author">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Anyone</SelectItem>
              {(members.data ?? []).map((m) => (
                <SelectItem key={m.userId} value={m.userId}>
                  {memberDisplayName(m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          )}
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-2">
          {!q ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Search text across the channels you can see. Filter by channel or author.</p>
          ) : results.isPending ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Searching…</p>
          ) : results.isError ? (
            <p className="p-6 text-center text-sm text-destructive">Search failed. Try again.</p>
          ) : results.data.results.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">No messages match “{q}”.</p>
          ) : (
            <>
              <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {results.data.total} result{results.data.total === 1 ? "" : "s"}
              </p>
              <ul className="space-y-1">
                {results.data.results.map((r) => (
                  <li key={r.message.id}>
                    <button type="button" onClick={() => open(r.message)} className="w-full rounded-md border bg-card px-3 py-2 text-left transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                      <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                        {r.workspace?.kind === "dm" ? (
                          <span>Direct message with {r.workspace.dmPeerName ?? "Deleted user"}</span>
                        ) : (
                          <>
                            {r.workspace ? <span className="font-medium">{r.workspace.name}</span> : null}
                            <Hash className="size-3" aria-hidden />
                            <span>{r.channelName}</span>
                          </>
                        )}
                        <span aria-hidden>·</span>
                        <UserAvatar user={r.message.author} size="xs" />
                        <span className="font-medium text-foreground">{r.message.author.nickname ?? r.message.author.displayName}</span>
                        <span className="ml-auto">{formatMessageTimestamp(r.message.createdAt)}</span>
                      </div>
                      <p className="line-clamp-2 text-sm">{renderSnippet(r.snippet)}</p>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The Worker marks matches with \u0001…\u0002; render them as <mark>. */
function renderSnippet(snippet: string): ReactNode[] {
  const parts = snippet.split(/([\u0001\u0002])/);
  const out: ReactNode[] = [];
  let mark = false;
  parts.forEach((p, i) => {
    if (p === "\u0001") mark = true;
    else if (p === "\u0002") mark = false;
    else if (p) out.push(mark ? <mark key={i} className="rounded bg-warning/40 px-0.5 text-foreground">{p}</mark> : <span key={i}>{p}</span>);
  });
  return out;
}
