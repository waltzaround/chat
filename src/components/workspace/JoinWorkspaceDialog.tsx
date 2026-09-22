import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function JoinWorkspaceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [value, setValue] = useState("");
  const navigate = useNavigate();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    const match = trimmed.match(/invite\/([A-Za-z0-9]+)/);
    const code = match ? match[1] : trimmed.replace(/[^A-Za-z0-9]/g, "");
    if (!code) return;
    onOpenChange(false);
    setValue("");
    navigate(`/invite/${code}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Join a workspace</DialogTitle>
            <DialogDescription>Paste an invite link or code you received from a member.</DialogDescription>
          </DialogHeader>
          <div className="my-5 grid gap-1.5">
            <Label htmlFor="invite">Invite link</Label>
            <Input id="invite" value={value} onChange={(e) => setValue(e.target.value)} placeholder={`${window.location.origin}/invite/hS82kaP`} autoFocus required />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!value.trim()}>
              Continue
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
