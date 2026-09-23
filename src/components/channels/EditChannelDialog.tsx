import { useEffect, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUpdateChannel, useWorkspace } from "@/lib/queries";
import { errorMessage } from "@/lib/api";
import type { Channel } from "@shared/types";

export function EditChannelDialog({ workspaceId, channel, open, onOpenChange }: { workspaceId: string; channel: Channel; open: boolean; onOpenChange: (open: boolean) => void }) {
  const ws = useWorkspace(workspaceId);
  const update = useUpdateChannel(workspaceId);
  const [name, setName] = useState(channel.name);
  const [topic, setTopic] = useState(channel.topic ?? "");
  const [category, setCategory] = useState(channel.categoryId ?? "none");

  useEffect(() => {
    if (open) {
      setName(channel.name);
      setTopic(channel.topic ?? "");
      setCategory(channel.categoryId ?? "none");
    }
  }, [open, channel]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await update.mutateAsync({ channelId: channel.id, name: name.trim(), topic: topic.trim() || null, categoryId: category === "none" ? null : category });
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Edit {channel.kind === "text" ? `#${channel.name}` : channel.name}</DialogTitle>
            <DialogDescription>Permission overrides for this channel live in Workspace settings → Channels.</DialogDescription>
          </DialogHeader>
          <div className="my-5 grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="edit-name">Name</Label>
              <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={64} required />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="edit-topic">Topic</Label>
              <Input id="edit-topic" value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={256} placeholder="What is this channel about?" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="edit-category">Section</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="edit-category" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No section</SelectItem>
                  {(ws.data?.categories ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={update.isPending || !name.trim()}>
              {update.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
