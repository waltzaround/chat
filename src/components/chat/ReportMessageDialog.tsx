import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useReportMessage } from "@/lib/queries";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Message, ReportReason } from "@shared/types";

export const REPORT_REASONS: Array<{ value: ReportReason; label: string; description: string }> = [
  { value: "spam", label: "Spam", description: "Ads, scams, or repeated unwanted messages" },
  { value: "harassment", label: "Harassment", description: "Targeting, threatening, or bullying someone" },
  { value: "inappropriate", label: "Inappropriate content", description: "Explicit, violent, or against the rules here" },
  { value: "other", label: "Something else", description: "Tell the moderators below" },
];

/** Flag a message for this workspace's moderators. Only they see the report. */
export function ReportMessageDialog({ message, channelId, open, onOpenChange }: { message: Message; channelId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState("");
  const report = useReportMessage(channelId);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!reason) return;
    report.mutate(
      { messageId: message.id, reason, note: note.trim() || undefined },
      {
        onSuccess: () => {
          toast.success("Thanks. The moderators will take a look.");
          onOpenChange(false);
          setReason(null);
          setNote("");
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
            <DialogTitle>Report message</DialogTitle>
            <DialogDescription>Only this workspace's moderators see reports. {message.author?.displayName ?? "The author"} isn't told who reported it.</DialogDescription>
          </DialogHeader>
          <div role="radiogroup" aria-label="Reason" className="grid gap-2">
            {REPORT_REASONS.map((r) => (
              <button
                key={r.value}
                type="button"
                role="radio"
                aria-checked={reason === r.value}
                onClick={() => setReason(r.value)}
                className={cn("rounded-md border px-3 py-2 text-left transition-colors hover:bg-accent/50", reason === r.value && "border-primary bg-primary/5")}
              >
                <span className="block text-sm font-medium">{r.label}</span>
                <span className="block text-xs text-muted-foreground">{r.description}</span>
              </button>
            ))}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="report-note">Anything else? (optional)</Label>
            <Textarea id="report-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} className="resize-none" />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!reason || report.isPending}>
              {report.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Send report
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
