import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { Hash, Loader2, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateChannel } from "@/lib/queries";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Category } from "@shared/types";

export function CreateChannelDialog({
  workspaceId,
  open,
  onOpenChange,
  categoryId,
  categories,
  initialKind,
}: {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categoryId: string | null;
  categories: Category[];
  initialKind: "text" | "voice";
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"text" | "voice">(initialKind);
  const [category, setCategory] = useState<string>(categoryId ?? "none");
  const create = useCreateChannel(workspaceId);
  const navigate = useNavigate();

  useEffect(() => {
    if (open) {
      setKind(initialKind);
      setCategory(categoryId ?? "none");
      setName("");
    }
  }, [open, initialKind, categoryId]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const ch = await create.mutateAsync({ name: name.trim(), kind, categoryId: category === "none" ? null : category });
      onOpenChange(false);
      if (ch) navigate(`/w/${workspaceId}/c/${ch.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Create channel</DialogTitle>
            <DialogDescription>Text channels hold conversations; voice channels are rooms people can talk, video call and share screens in.</DialogDescription>
          </DialogHeader>
          <div className="my-5 grid gap-4">
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-xs font-medium text-muted-foreground">Channel type</legend>
              {(["text", "voice"] as const).map((k) => (
                <label
                  key={k}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 transition-colors hover:bg-accent",
                    kind === k && "border-primary/60 bg-accent",
                  )}
                >
                  <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="sr-only" />
                  {k === "text" ? <Hash className="size-5 text-muted-foreground" aria-hidden /> : <Volume2 className="size-5 text-muted-foreground" aria-hidden />}
                  <span className="flex-1">
                    <span className="block text-sm font-medium">{k === "text" ? "Text" : "Voice"}</span>
                    <span className="block text-xs text-muted-foreground">{k === "text" ? "Messages, files and threads of discussion" : "Talk, video and screen share — with its own chat"}</span>
                  </span>
                  <span className={cn("size-3.5 rounded-full border", kind === k ? "border-primary bg-primary" : "border-muted-foreground/40")} aria-hidden />
                </label>
              ))}
            </fieldset>
            <div className="grid gap-1.5">
              <Label htmlFor="ch-name">Channel name</Label>
              <div className="relative">
                {kind === "text" ? <Hash className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden /> : <Volume2 className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />}
                <Input id="ch-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "text" ? "new-channel" : "Lounge"} maxLength={64} required className="pl-8" autoFocus />
              </div>
            </div>
            {categories.length ? (
              <div className="grid gap-1.5">
                <Label htmlFor="ch-category">Section</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger id="ch-category" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No section</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || !name.trim()}>
              {create.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Create channel
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
