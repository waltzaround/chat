import { useState } from "react";
import { Copy, Check, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { InviteDialog } from "@/components/workspace/InviteDialog";
import { useInvites, useRevokeInvite } from "@/lib/queries";
import { errorMessage } from "@/lib/api";
import { formatFull } from "@/lib/format";
import type { WorkspaceDetail } from "@shared/types";

interface InvitesPanelProps {
  ws: WorkspaceDetail;
}

export function InvitesPanel({ ws }: InvitesPanelProps) {
  const { data: invites = [] } = useInvites(ws.id);
  const revoke = useRevokeInvite(ws.id);
  const [revokeCode, setRevokeCode] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const handleCopy = async (url: string, code: string) => {
    await navigator.clipboard.writeText(url);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const handleRevoke = async (code: string) => {
    try {
      await revoke.mutateAsync(code);
      toast.success("Invite revoked");
      setRevokeCode(null);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const active = invites.filter((i) => !i.revokedAt);

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium">Active invites</h3>
        <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
          Create invite
        </Button>
      </div>

      {active.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active invites.</p>
      ) : (
        <div className="rounded-md border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Code</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Created by</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Uses</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Expires</th>
                <th className="w-20 px-2" />
              </tr>
            </thead>
            <tbody>
              {active.map((inv, idx) => (
                <tr key={inv.code} className={idx % 2 === 0 ? "bg-background" : "bg-muted/10"}>
                  <td className="px-3 py-2 font-mono text-xs">{inv.code}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{inv.createdBy?.displayName ?? "Unknown"}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {inv.uses}{inv.maxUses ? ` / ${inv.maxUses}` : ""}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {inv.expiresAt ? formatFull(inv.expiresAt) : "Never"}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        aria-label="Copy invite link"
                        onClick={() => void handleCopy(inv.url, inv.code)}
                      >
                        {copiedCode === inv.code ? <Check className="size-3.5 text-success" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-7 text-destructive hover:text-destructive"
                        aria-label="Revoke invite"
                        onClick={() => setRevokeCode(inv.code)}
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <InviteDialog workspace={ws} open={createOpen} onOpenChange={setCreateOpen} />

      {revokeCode && (
        <AlertDialog open onOpenChange={(o) => !o && setRevokeCode(null)}>
          <AlertDialogContent size="sm">
            <AlertDialogHeader>
              <AlertDialogTitle>Revoke invite?</AlertDialogTitle>
              <AlertDialogDescription>This link will stop working immediately.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setRevokeCode(null)}>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => void handleRevoke(revokeCode)}>Revoke</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}
