import { useEffect, useState } from "react";
import { Check, Copy, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateInvite } from "@/lib/queries";
import { errorMessage } from "@/lib/api";
import type { Invite, WorkspaceDetail } from "@shared/types";

const EXPIRY = [
  { label: "30 minutes", value: 1800 },
  { label: "1 day", value: 86400 },
  { label: "7 days", value: 604800 },
  { label: "30 days", value: 2592000 },
  { label: "Never", value: 0 },
];
const USES = [
  { label: "No limit", value: 0 },
  { label: "1 use", value: 1 },
  { label: "5 uses", value: 5 },
  { label: "25 uses", value: 25 },
  { label: "100 uses", value: 100 },
];

export function InviteDialog({ workspace, open, onOpenChange }: { workspace: WorkspaceDetail; open: boolean; onOpenChange: (open: boolean) => void }) {
  const create = useCreateInvite(workspace.id);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [expiry, setExpiry] = useState("604800");
  const [uses, setUses] = useState("0");
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    try {
      const inv = await create.mutateAsync({ expiresIn: Number(expiry) || null, maxUses: Number(uses) || null });
      setInvite(inv);
      setCopied(false);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  useEffect(() => {
    if (open && !invite) void generate();
    if (!open) setInvite(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const copy = async () => {
    if (!invite) return;
    await navigator.clipboard.writeText(invite.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite people to {workspace.name}</DialogTitle>
          <DialogDescription>Share this link. Anyone with it can join while it is valid.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="invite-url">Invite link</Label>
            <div className="flex gap-2">
              <Input id="invite-url" readOnly value={invite?.url ?? ""} placeholder={create.isPending ? "Generating…" : ""} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
              <Button type="button" onClick={() => void copy()} disabled={!invite} className="w-24">
                {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            {invite ? (
              <p className="text-xs text-muted-foreground">
                {invite.expiresAt ? `Expires ${new Date(invite.expiresAt).toLocaleString()}` : "Never expires"}
                {invite.maxUses ? ` · ${invite.maxUses} use${invite.maxUses === 1 ? "" : "s"}` : ""}
              </p>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="invite-expiry">Expire after</Label>
              <Select value={expiry} onValueChange={setExpiry}>
                <SelectTrigger id="invite-expiry" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPIRY.map((o) => (
                    <SelectItem key={o.value} value={String(o.value)}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="invite-uses">Max uses</Label>
              <Select value={uses} onValueChange={setUses}>
                <SelectTrigger id="invite-uses" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {USES.map((o) => (
                    <SelectItem key={o.value} value={String(o.value)}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button type="button" variant="outline" onClick={() => void generate()} disabled={create.isPending} className="justify-self-start">
            {create.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
            Generate a new link
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
