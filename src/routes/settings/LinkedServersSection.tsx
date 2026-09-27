import { Globe, Unlink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { isDesktopApp } from "@/lib/desktop";
import { useLinkedServers, useUnlinkServer } from "@/lib/linked-servers";

/** Profile tab: other servers shown in this server's rail. */
export function LinkedServersSection() {
  const servers = useLinkedServers().data ?? [];
  const unlink = useUnlinkServer();
  return (
    <div className="grid max-w-sm gap-6">
      <Separator />
      <div className="grid gap-2">
        <h2 className="text-base font-semibold">Your other servers</h2>
        <p className="text-sm text-muted-foreground">
          Chat servers on other domains shown in your server rail. They can see which workspaces you're in and your unread counts, nothing more.
          {isDesktopApp() ? " The desktop app shares this list across all your servers." : ""}
        </p>
        {servers.length === 0 ? (
          <p className="text-sm text-muted-foreground">None yet. Use the globe button in the server rail to add one.</p>
        ) : (
          <ul className="grid gap-1">
            {servers.map((server) => (
              <li key={server.origin} className="flex items-center gap-3 rounded-md border px-3 py-2">
                <Globe className="size-4 text-muted-foreground" aria-hidden />
                <span className="flex-1 truncate text-sm">{new URL(server.origin).host}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={unlink.isPending}
                  onClick={() =>
                    unlink.mutate(server, {
                      onSuccess: () => toast.success(`Removed ${new URL(server.origin).host}`),
                    })
                  }
                >
                  <Unlink className="size-3.5" aria-hidden />
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
