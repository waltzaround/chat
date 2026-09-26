import { CheckCircle2, Loader2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/common/UserAvatar";
import { useReports, useResolveReport } from "@/lib/queries";
import { errorMessage } from "@/lib/api";
import { formatFull } from "@/lib/format";
import { REPORT_REASONS } from "@/components/chat/ReportMessageDialog";
import type { ReportedMessage } from "@shared/types";

const reasonLabel = (value: string) => REPORT_REASONS.find((r) => r.value === value)?.label ?? value;

/** Moderation queue: reported messages in channels this member can moderate. */
export function ReportsPanel({ workspaceId }: { workspaceId: string }) {
  const reports = useReports(workspaceId);

  if (reports.isPending) {
    return <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading reports" />;
  }
  if (reports.isError) return <p className="text-sm text-destructive">{errorMessage(reports.error)}</p>;
  if (reports.data.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-md border py-10 text-center">
        <CheckCircle2 className="size-6 text-success" aria-hidden />
        <p className="text-sm font-medium">No open reports</p>
        <p className="text-xs text-muted-foreground">When someone reports a message, it shows up here.</p>
      </div>
    );
  }
  return (
    <ul className="grid gap-3">
      {reports.data.map((item) => (
        <ReportCard key={item.messageId} workspaceId={workspaceId} item={item} />
      ))}
    </ul>
  );
}

function ReportCard({ workspaceId, item }: { workspaceId: string; item: ReportedMessage }) {
  const resolve = useResolveReport(workspaceId);
  const act = (action: "remove" | "dismiss") =>
    resolve.mutate(
      { messageId: item.messageId, action },
      {
        onSuccess: () => toast.success(action === "remove" ? "Message removed" : "Report dismissed"),
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  const reasons = [...new Set(item.reports.map((r) => r.reason))];

  return (
    <li className="grid gap-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {reasons.map((r) => (
          <Badge key={r} variant="secondary">
            {reasonLabel(r)}
          </Badge>
        ))}
        <span>
          {item.reports.length} {item.reports.length === 1 ? "report" : "reports"} · #{item.channelName} · first {formatFull(item.firstReportedAt)}
        </span>
      </div>
      <div className="flex gap-2.5 rounded-md bg-muted/40 p-2.5">
        {item.author ? <UserAvatar user={item.author} size="sm" /> : null}
        <div className="min-w-0">
          <p className="text-sm font-medium">{item.author?.displayName ?? "Unknown"}</p>
          <p className="whitespace-pre-wrap break-words text-sm">{item.content || <span className="italic text-muted-foreground">(attachment only)</span>}</p>
          {item.messageDeleted ? <p className="mt-1 text-xs text-muted-foreground">Already deleted.</p> : null}
        </div>
      </div>
      {item.reports.some((r) => r.note) ? (
        <ul className="grid gap-1 text-xs text-muted-foreground">
          {item.reports
            .filter((r) => r.note)
            .map((r, i) => (
              <li key={i}>
                <span className="font-medium text-foreground">{r.reporter?.displayName ?? "Someone"}:</span> {r.note}
              </li>
            ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {item.messageDeleted ? null : (
          <Button type="button" size="sm" variant="destructive" onClick={() => act("remove")} disabled={resolve.isPending}>
            <Trash2 className="size-3.5" aria-hidden /> Remove message
          </Button>
        )}
        <Button type="button" size="sm" variant="outline" onClick={() => act("dismiss")} disabled={resolve.isPending}>
          <X className="size-3.5" aria-hidden /> {item.messageDeleted ? "Close" : "Keep message"}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">To remove {item.author?.displayName ?? "the author"} from the workspace, use the Members tab.</p>
    </li>
  );
}
