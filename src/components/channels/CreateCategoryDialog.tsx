import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateCategory } from "@/lib/queries";
import { errorMessage } from "@/lib/api";

export function CreateCategoryDialog({ workspaceId, open, onOpenChange }: { workspaceId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [name, setName] = useState("");
  const create = useCreateCategory(workspaceId);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await create.mutateAsync({ name: name.trim() });
      setName("");
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Create category</DialogTitle>
            <DialogDescription>Categories group channels in the sidebar.</DialogDescription>
          </DialogHeader>
          <div className="my-5 grid gap-1.5">
            <Label htmlFor="cat-name">Category name</Label>
            <Input id="cat-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Projects" maxLength={48} required autoFocus />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || !name.trim()}>
              {create.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
