import { useRef, useState } from "react";
import { Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useUpdateWorkspace } from "@/lib/queries";
import { uploadFile } from "@/lib/uploads";
import { errorMessage } from "@/lib/api";
import { WorkspaceIcon } from "./WorkspaceIcon";
import type { WorkspaceDetail } from "@shared/types";

/**
 * Quick logo change from the workspace menu: choose an image and it is saved
 * immediately (no separate save step). Shows how it will look in the rail.
 */
export function WorkspaceLogoDialog({ workspace, open, onOpenChange }: { workspace: WorkspaceDetail; open: boolean; onOpenChange: (open: boolean) => void }) {
  const update = useUpdateWorkspace(workspace.id);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error("Please choose an image (PNG, JPG, WebP or GIF)");
    if (file.size > 4 * 1024 * 1024) return toast.error("Logos are limited to 4 MB");
    setBusy(true);
    try {
      const uploaded = await uploadFile({ file, purpose: "workspace-icon" });
      await update.mutateAsync({ iconKey: uploaded.key });
      setPreview(URL.createObjectURL(file));
      toast.success("Workspace logo updated");
    } catch (err) {
      toast.error(errorMessage(err, "Could not update the logo"));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await update.mutateAsync({ iconKey: null });
      setPreview(null);
      toast.success("Workspace logo removed");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const shown = preview ? { ...workspace, iconUrl: preview } : workspace;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Workspace logo</DialogTitle>
          <DialogDescription>Shown in the workspace rail, invites and the member list. Square images at least 128×128 look best.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-5 py-2">
          <div className="flex flex-col items-center gap-2">
            <WorkspaceIcon workspace={shown} size="xl" />
            <span className="text-[10px] text-muted-foreground">Preview</span>
          </div>
          <div className="flex flex-1 flex-col gap-2">
            <Button type="button" onClick={() => inputRef.current?.click()} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
              {workspace.iconUrl ? "Upload a new logo" : "Upload logo"}
            </Button>
            {workspace.iconUrl ? (
              <Button type="button" variant="outline" onClick={() => void remove()} disabled={busy}>
                <Trash2 className="size-4" aria-hidden /> Remove logo
              </Button>
            ) : null}
            <p className="text-xs text-muted-foreground">Without a logo the workspace shows its initials on a colour derived from its id.</p>
          </div>
        </div>
        <input ref={inputRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-label="Choose workspace logo" onChange={(e) => void pick(e.target.files?.[0])} />
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
