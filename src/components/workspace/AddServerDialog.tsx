import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isDesktopApp } from "@/lib/desktop";
import { checkChatServer, normalizeOrigin, openOnServer, startBrowserLink } from "@/lib/linked-servers";

/** Shows another Chat server (another domain) in this rail. */
export function AddServerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const origin = normalizeOrigin(value);
    if (!origin) return setError("That doesn't look like a web address.");
    if (origin === window.location.origin) return setError("You're already on this server.");
    setBusy(true);
    try {
      await checkChatServer(origin);
      if (isDesktopApp()) {
        // The desktop app opens the server; once you sign in there it joins the rail.
        onOpenChange(false);
        openOnServer(origin, "/");
        return;
      }
      startBrowserLink(origin);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't link that server.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(e) => void submit(e)}>
          <DialogHeader>
            <DialogTitle>Add a server</DialogTitle>
            <DialogDescription>
              Belong to a Chat server on another domain? Add it to see its workspaces and unread messages here.
              {isDesktopApp() ? " You'll sign in to it next." : " You'll sign in to it and confirm, then come back here."}
            </DialogDescription>
          </DialogHeader>
          <div className="my-5 grid gap-1.5">
            <Label htmlFor="server-address">Server address</Label>
            <Input id="server-address" value={value} onChange={(e) => setValue(e.target.value)} placeholder="chat.example.com" autoFocus required autoCapitalize="off" autoCorrect="off" spellCheck={false} />
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !value.trim()}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Add server
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
