import { useEffect, useState } from "react";
import { Check, Copy, KeyRound, Loader2, Mail, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { UserAvatar } from "@/components/common/UserAvatar";
import { useCreatePasswordResetLink, useServerSettings, useServerUsers } from "@/lib/queries";
import { errorMessage } from "@/lib/api";
import type { PasswordResetLink, ServerUser } from "@shared/types";

/** Server owner: find any account and make a password-reset link for it. */
export function ServerAccounts() {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const users = useServerUsers(query);
  const createLink = useCreatePasswordResetLink();
  const [issued, setIssued] = useState<{ user: ServerUser; link: PasswordResetLink } | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setQuery(input.trim()), 250);
    return () => clearTimeout(id);
  }, [input]);

  const resetFor = (user: ServerUser) => {
    createLink.mutate(user.id, {
      onSuccess: (link) => setIssued({ user, link }),
      onError: (err) => toast.error(errorMessage(err)),
    });
  };

  return (
    <div className="grid gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Search by name, username or email" aria-label="Search accounts" className="pl-8" />
      </div>
      <ul className="divide-y rounded-md border">
        {users.isPending ? (
          <li className="flex justify-center p-4">
            <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Loading accounts" />
          </li>
        ) : users.data?.length ? (
          users.data.map((user) => (
            <li key={user.id} className="flex items-center gap-3 px-3 py-2">
              <UserAvatar user={user} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                  {user.displayName}
                  {user.isServerOwner ? <Badge variant="secondary">Owner</Badge> : null}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  @{user.username} · {user.email}
                </p>
              </div>
              {user.isServerOwner ? null : (
                <Button type="button" variant="outline" size="sm" onClick={() => resetFor(user)} disabled={createLink.isPending}>
                  <KeyRound className="size-3.5" aria-hidden /> Reset link
                </Button>
              )}
            </li>
          ))
        ) : (
          <li className="p-4 text-center text-sm text-muted-foreground">No accounts match.</li>
        )}
      </ul>
      <ResetLinkDialog issued={issued} onClose={() => setIssued(null)} />
    </div>
  );
}

function ResetLinkDialog({ issued, onClose }: { issued: { user: ServerUser; link: PasswordResetLink } | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!issued) return;
    await navigator.clipboard.writeText(issued.link.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Dialog open={!!issued} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reset link for {issued?.user.displayName}</DialogTitle>
          <DialogDescription>
            Anyone with this link can set a new password for @{issued?.user.username}, so send it privately. It works once and expires in 24 hours.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input readOnly value={issued?.link.url ?? ""} aria-label="Reset link" onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
          <Button type="button" variant="outline" onClick={() => void copy()} aria-label="Copy reset link">
            {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          </Button>
        </div>
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Whether members can reset their own password by email, and what turning it on takes. */
export function EmailStatus() {
  const settings = useServerSettings();
  if (!settings.data) return null;
  return (
    <div className="flex items-start gap-3 rounded-md border px-3 py-2.5">
      <Mail className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      {settings.data.emailEnabled ? (
        <p className="text-sm">
          <span className="font-medium">Email is on.</span> <span className="text-muted-foreground">Members can reset their own password with "Forgot password?".</span>
        </p>
      ) : (
        <div className="grid gap-1 text-sm">
          <p className="font-medium">Email is off</p>
          <p className="text-xs text-muted-foreground">
            Members who forget their password need a reset link from you (below). Password-reset email needs the Cloudflare <span className="font-medium text-foreground">Workers Paid plan</span> ($5/month) and your own domain on Cloudflare DNS. To turn it on, run <code className="rounded bg-muted px-1 py-0.5">npm run setup</code> again and choose email.
          </p>
        </div>
      )}
    </div>
  );
}
