import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Check, Compass, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CreateWorkspaceForm } from "@/components/workspace/CreateWorkspaceDialog";
import { JoinWorkspaceDialog } from "@/components/workspace/JoinWorkspaceDialog";
import { UserPanel } from "@/components/channels/UserPanel";
import { SetupSteps } from "@/components/onboarding/SetupSteps";
import { RegistrationPolicyPicker } from "@/components/onboarding/RegistrationPolicyPicker";
import { useCreateInvite, useMe } from "@/lib/queries";
import { errorMessage } from "@/lib/api";
import type { WorkspaceDetail } from "@shared/types";

/** Where people land with no workspace. For a new server's owner, steps 2 and 3 of setup. */
export function NoWorkspacePage() {
  const [joinOpen, setJoinOpen] = useState(false);
  const [created, setCreated] = useState<WorkspaceDetail | null>(null);
  const owner = useMe().data?.isServerOwner ?? false;

  return (
    <div className="flex h-dvh flex-col bg-background">
      <main className="flex flex-1 flex-col items-center justify-center gap-4 overflow-y-auto p-6 text-center">
        {owner ? <SetupSteps current={created ? 2 : 1} /> : null}
        <div className="w-full max-w-sm rounded-lg border bg-card p-6 shadow-sm">
          {created ? (
            <InvitePeople workspace={created} owner={owner} />
          ) : (
            <CreateWorkspaceForm
              stay
              onCreated={setCreated}
              header={
                <div className="space-y-1">
                  <h1 className="text-xl font-semibold">{owner ? "Name your community" : "Create your workspace"}</h1>
                  <p className="text-sm text-muted-foreground">A workspace is where your community lives. You can change the name and icon later.</p>
                </div>
              }
            />
          )}
        </div>
        {created ? null : (
          <Button variant="ghost" size="sm" onClick={() => setJoinOpen(true)}>
            <Compass className="size-4" aria-hidden /> Have an invite link? Join a workspace
          </Button>
        )}
      </main>
      <div className="mx-auto w-full max-w-xs">
        <UserPanel />
      </div>
      <JoinWorkspaceDialog open={joinOpen} onOpenChange={setJoinOpen} />
    </div>
  );
}

function InvitePeople({ workspace, owner }: { workspace: WorkspaceDetail; owner: boolean }) {
  const navigate = useNavigate();
  const createInvite = useCreateInvite(workspace.id);
  const [copied, setCopied] = useState(false);
  const requested = useRef(false);
  const general = workspace.channels.find((c) => c.kind === "text");

  // One link that never expires, so it can go in a bio, a group chat, or an email.
  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    createInvite.mutate({ expiresIn: null, maxUses: null }, { onError: (err) => toast.error(errorMessage(err)) });
  }, [createInvite]);

  const url = createInvite.data?.url;
  const copy = async () => {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="grid gap-5 text-left">
      <div className="space-y-1 text-center">
        <h1 className="text-xl font-semibold">Invite people</h1>
        <p className="text-sm text-muted-foreground">Share this link to bring people into {workspace.name}.</p>
      </div>

      <div className="flex gap-2">
        <Input readOnly value={url ?? ""} placeholder="Creating a link…" aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
        <Button type="button" variant="outline" onClick={() => void copy()} disabled={!url} aria-label="Copy invite link">
          {createInvite.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
        </Button>
      </div>

      {owner ? (
        <div className="grid gap-2">
          <p className="text-sm font-medium">Who can create an account on this server?</p>
          <RegistrationPolicyPicker />
          <p className="text-[11px] text-muted-foreground">You can change this later in User Settings → Server.</p>
        </div>
      ) : null}

      <Button type="button" onClick={() => navigate(general ? `/w/${workspace.id}/c/${general.id}` : `/w/${workspace.id}`)}>
        {general ? `Open #${general.name}` : "Open workspace"}
      </Button>
    </div>
  );
}
