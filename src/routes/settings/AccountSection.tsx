import { useState, type FormEvent } from "react";
import { Download, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useDeleteMe, useMe } from "@/lib/queries";
import { errorMessage } from "@/lib/api";

/** Profile tab: download your data, or delete your account. */
export function AccountSection() {
  const me = useMe().data;
  const [downloading, setDownloading] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const download = async () => {
    setDownloading(true);
    try {
      const res = await fetch("/api/me/export", { credentials: "include" });
      if (!res.ok) throw new Error(res.status === 429 ? "You can download your data 3 times an hour. Try again later." : "Could not prepare your data");
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "chat-export.json";
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), { href: url, download: name });
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setDownloading(false);
    }
  };

  if (!me) return null;
  return (
    <div className="grid max-w-sm gap-6">
      <Separator />
      <div className="grid gap-2">
        <h2 className="text-base font-semibold">Your data</h2>
        <p className="text-sm text-muted-foreground">Download your profile, workspaces, messages and reactions as a JSON file.</p>
        <div>
          <Button type="button" variant="outline" onClick={() => void download()} disabled={downloading}>
            {downloading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}
            Download my data
          </Button>
        </div>
      </div>
      <div className="grid gap-2">
        <h2 className="text-base font-semibold text-destructive">Delete account</h2>
        <p className="text-sm text-muted-foreground">
          {me.isServerOwner
            ? "You own this server, so your account can't be deleted."
            : "Your profile is erased and you leave every workspace. Your messages stay as “Deleted user” unless you choose to delete them too. This can't be undone."}
        </p>
        {me.isServerOwner ? null : (
          <div>
            <Button type="button" variant="destructive" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="size-4" aria-hidden /> Delete my account
            </Button>
          </div>
        )}
      </div>
      <DeleteAccountDialog open={deleteOpen} onOpenChange={setDeleteOpen} username={me.username} hasPassword={me.hasPassword} />
    </div>
  );
}

function DeleteAccountDialog({ open, onOpenChange, username, hasPassword }: { open: boolean; onOpenChange: (open: boolean) => void; username: string; hasPassword: boolean }) {
  const [confirmUsername, setConfirmUsername] = useState("");
  const [password, setPassword] = useState("");
  const [deleteMessages, setDeleteMessages] = useState(false);
  const del = useDeleteMe();
  const ready = confirmUsername.trim().toLowerCase() === username.toLowerCase() && (!hasPassword || password.length > 0);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    del.mutate(
      { confirmUsername, password: hasPassword ? password : undefined, deleteMessages },
      {
        onSuccess: () => {
          toast.success("Your account was deleted");
          window.location.assign("/login");
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>You'll be signed out everywhere and leave every workspace. If you own a workspace, transfer it to someone first (Workspace settings → Members).</DialogDescription>
          </DialogHeader>
          <label className="flex items-start gap-2.5 text-sm">
            <Checkbox checked={deleteMessages} onCheckedChange={(v) => setDeleteMessages(v === true)} className="mt-0.5" />
            <span>
              Also delete all my messages
              <span className="block text-xs text-muted-foreground">Otherwise they stay, shown as from "Deleted user".</span>
            </span>
          </label>
          <div className="grid gap-1.5">
            <Label htmlFor="confirm-username">Type your username, {username}, to confirm</Label>
            <Input id="confirm-username" value={confirmUsername} onChange={(e) => setConfirmUsername(e.target.value)} autoComplete="off" />
          </div>
          {hasPassword ? (
            <div className="grid gap-1.5">
              <Label htmlFor="delete-password">Password</Label>
              <Input id="delete-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={!ready || del.isPending}>
              {del.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Delete account
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
