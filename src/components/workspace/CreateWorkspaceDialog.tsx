import { useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateWorkspace } from "@/lib/queries";
import { errorMessage } from "@/lib/api";
import { ImagePicker } from "@/components/common/ImagePicker";
import type { WorkspaceDetail } from "@shared/types";

/**
 * Name + icon form that creates a workspace and opens its #general channel.
 * `header` and `actions` let the dialog and the welcome page frame it differently.
 * With `stay`, the caller handles what comes next through `onCreated`.
 */
export function CreateWorkspaceForm({
  header,
  actions,
  onCreated,
  stay = false,
}: {
  header?: ReactNode;
  actions?: (state: { pending: boolean; canSubmit: boolean }) => ReactNode;
  onCreated?: (workspace: WorkspaceDetail) => void;
  stay?: boolean;
}) {
  const [name, setName] = useState("");
  const [iconKey, setIconKey] = useState<string | null>(null);
  const create = useCreateWorkspace();
  const navigate = useNavigate();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const ws = await create.mutateAsync({ name: name.trim(), iconKey });
      onCreated?.(ws);
      setName("");
      setIconKey(null);
      if (stay) return;
      const general = ws.channels.find((c) => c.kind === "text");
      navigate(general ? `/w/${ws.id}/c/${general.id}` : `/w/${ws.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const state = { pending: create.isPending, canSubmit: !create.isPending && !!name.trim() };

  return (
    <form onSubmit={submit}>
      {header}
      <div className="my-5 grid gap-4">
        <div className="flex justify-center">
          <ImagePicker purpose="workspace-icon" value={iconKey} onChange={setIconKey} label="Upload workspace icon" fallbackText={name || "?"} />
        </div>
        <div className="grid gap-1.5 text-left">
          <Label htmlFor="ws-name">Workspace name</Label>
          <Input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Community" maxLength={64} autoFocus required />
        </div>
        <p className="text-xs text-muted-foreground">We will set up a #general text channel and a Lounge voice channel to get you started.</p>
      </div>
      {actions ? (
        actions(state)
      ) : (
        <Button type="submit" className="w-full" disabled={!state.canSubmit}>
          {state.pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          Create workspace
        </Button>
      )}
    </form>
  );
}

export function CreateWorkspaceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <CreateWorkspaceForm
          onCreated={() => onOpenChange(false)}
          header={
            <DialogHeader>
              <DialogTitle>Create a workspace</DialogTitle>
              <DialogDescription>A workspace is where your community lives. You can change the name and icon later.</DialogDescription>
            </DialogHeader>
          }
          actions={({ pending, canSubmit }) => (
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!canSubmit}>
                {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                Create
              </Button>
            </DialogFooter>
          )}
        />
      </DialogContent>
    </Dialog>
  );
}
