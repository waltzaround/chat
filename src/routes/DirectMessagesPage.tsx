import { useState } from "react";
import { Navigate } from "react-router";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FullscreenSpinner } from "@/components/common/FullscreenSpinner";
import { WorkspaceRail } from "@/components/workspace/WorkspaceRail";
import { DirectMessagesSidebar, NewMessageDialog } from "@/components/dms/DirectMessagesSidebar";
import { useDms } from "@/lib/queries";

/** /dms: open your latest conversation, or offer to start one. */
export function DirectMessagesPage() {
  const dms = useDms();
  const [newOpen, setNewOpen] = useState(false);
  if (dms.isPending) return <FullscreenSpinner />;
  const latest = dms.data?.[0];
  if (latest) return <Navigate to={`/w/${latest.workspaceId}/c/${latest.channelId}`} replace />;
  return (
    <div className="flex h-dvh w-full bg-background text-foreground">
      <WorkspaceRail />
      <div className="hidden md:flex">
        <DirectMessagesSidebar />
      </div>
      <main className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <MessageCircle className="size-10 text-muted-foreground" aria-hidden />
        <h1 className="text-lg font-semibold">No direct messages yet</h1>
        <p className="max-w-sm text-sm text-muted-foreground">Message anyone you share a workspace with. Conversations are just between the two of you.</p>
        <Button onClick={() => setNewOpen(true)}>New message</Button>
        <NewMessageDialog open={newOpen} onOpenChange={setNewOpen} />
      </main>
    </div>
  );
}
