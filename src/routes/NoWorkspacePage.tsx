import { useState } from "react";
import { Compass, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CreateWorkspaceDialog } from "@/components/workspace/CreateWorkspaceDialog";
import { JoinWorkspaceDialog } from "@/components/workspace/JoinWorkspaceDialog";
import { UserPanel } from "@/components/channels/UserPanel";

export function NoWorkspacePage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  return (
    <div className="flex h-dvh flex-col bg-background">
      <main className="flex flex-1 flex-col items-center justify-center gap-6 p-6 text-center">
        <img src="/favicon.svg" alt="" className="size-14 rounded-xl" />
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Welcome to Commons</h1>
          <p className="max-w-sm text-sm text-muted-foreground">You are not part of any workspace yet. Create one for your community, or join one with an invite link.</p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden /> Create a workspace
          </Button>
          <Button variant="outline" onClick={() => setJoinOpen(true)}>
            <Compass className="size-4" aria-hidden /> Join with an invite
          </Button>
        </div>
      </main>
      <div className="mx-auto w-full max-w-xs">
        <UserPanel />
      </div>
      <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
      <JoinWorkspaceDialog open={joinOpen} onOpenChange={setJoinOpen} />
    </div>
  );
}
