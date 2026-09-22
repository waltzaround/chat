import { useState } from "react";
import { Minus, Plus, Check, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useOverwrites, useOverwriteMutations } from "@/lib/queries";
import { errorMessage } from "@/lib/api";
import { PERMISSION_NAMES, PERMISSION_LABELS, CHANNEL_PERMISSIONS, Permission } from "@shared/permissions";
import { cn } from "@/lib/utils";
import type { Role, Member } from "@shared/types";

interface ChannelOverridesEditorProps {
  channelId: string;
  workspaceId: string;
  roles: Role[];
  members: Member[];
}

type PermState = "allow" | "deny" | "inherit";

const CHANNEL_PERM_NAMES = PERMISSION_NAMES.filter((n) => (Permission[n] & CHANNEL_PERMISSIONS) !== 0);

export function ChannelOverridesEditor({ channelId, workspaceId, roles, members }: ChannelOverridesEditorProps) {
  const { data: overwrites = [] } = useOverwrites(channelId);
  const { set, remove } = useOverwriteMutations(channelId, workspaceId);

  const [addType, setAddType] = useState<"role" | "user">("role");
  const [addId, setAddId] = useState("");

  const handleAdd = async () => {
    if (!addId) return;
    try {
      await set.mutateAsync({ targetType: addType, targetId: addId, allow: 0, deny: 0 });
      setAddId("");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const toggleState = async (targetType: "role" | "user", targetId: string, bit: number, current: PermState) => {
    const ow = overwrites.find((o) => o.targetType === targetType && o.targetId === targetId);
    let allow = ow?.allow ?? 0;
    let deny = ow?.deny ?? 0;

    // cycle: inherit → allow → deny → inherit
    allow &= ~bit;
    deny &= ~bit;
    if (current === "inherit") allow |= bit;
    else if (current === "allow") deny |= bit;
    // deny → inherit: neither set

    try {
      await set.mutateAsync({ targetType, targetId, allow, deny });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const handleRemove = async (targetType: "role" | "user", targetId: string) => {
    try {
      await remove.mutateAsync({ targetType, targetId });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const getState = (targetType: "role" | "user", targetId: string, bit: number): PermState => {
    const ow = overwrites.find((o) => o.targetType === targetType && o.targetId === targetId);
    if (!ow) return "inherit";
    if ((ow.allow & bit) !== 0) return "allow";
    if ((ow.deny & bit) !== 0) return "deny";
    return "inherit";
  };

  const getRoleName = (id: string) => roles.find((r) => r.id === id)?.name ?? id;
  const getMemberName = (id: string) => {
    const m = members.find((mm) => mm.userId === id);
    return m ? (m.nickname ?? m.displayName) : id;
  };
  const getTargetName = (type: "role" | "user", id: string) => type === "role" ? getRoleName(id) : getMemberName(id);

  const existingIds = new Set(overwrites.map((o) => `${o.targetType}:${o.targetId}`));

  const availableRoles = roles.filter((r) => !existingIds.has(`role:${r.id}`));
  const availableMembers = members.filter((m) => !existingIds.has(`user:${m.userId}`));

  return (
    <div className="grid gap-5">
      {/* Add overwrite */}
      <div className="flex items-end gap-2">
        <div className="grid gap-1.5">
          <Label htmlFor="ow-type">Target type</Label>
          <Select value={addType} onValueChange={(v) => { setAddType(v as "role" | "user"); setAddId(""); }}>
            <SelectTrigger id="ow-type" className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="role">Role</SelectItem>
              <SelectItem value="user">Member</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid flex-1 gap-1.5">
          <Label htmlFor="ow-target">Target</Label>
          <Select value={addId} onValueChange={setAddId}>
            <SelectTrigger id="ow-target">
              <SelectValue placeholder={`Pick a ${addType === "role" ? "role" : "member"}`} />
            </SelectTrigger>
            <SelectContent>
              {addType === "role"
                ? availableRoles.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)
                : availableMembers.map((m) => <SelectItem key={m.userId} value={m.userId}>{m.nickname ?? m.displayName}</SelectItem>)
              }
            </SelectContent>
          </Select>
        </div>
        <Button type="button" size="sm" onClick={() => void handleAdd()} disabled={!addId || set.isPending} className="gap-1.5">
          <Plus className="size-3.5" aria-hidden />
          Add
        </Button>
      </div>

      {/* Existing overwrites */}
      {overwrites.length === 0 ? (
        <p className="text-sm text-muted-foreground">No permission overrides. Add a role or member above.</p>
      ) : (
        <div className="grid gap-4">
          {overwrites.map((ow) => (
            <div key={`${ow.targetType}:${ow.targetId}`} className="rounded-md border border-border">
              <div className="flex items-center justify-between px-3 py-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">{ow.targetType === "role" ? "Role" : "Member"}</span>
                  <span className="text-sm font-medium">{getTargetName(ow.targetType, ow.targetId)}</span>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" size="icon" variant="ghost" className="size-6" aria-label="Remove override">
                      <X className="size-3.5" aria-hidden />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent size="sm">
                    <AlertDialogHeader>
                      <AlertDialogTitle>Remove override?</AlertDialogTitle>
                      <AlertDialogDescription>Remove all permission overrides for {getTargetName(ow.targetType, ow.targetId)}?</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction variant="destructive" onClick={() => void handleRemove(ow.targetType, ow.targetId)}>Remove</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
              <Separator />
              <div className="px-3 py-2 grid gap-1">
                {CHANNEL_PERM_NAMES.map((name) => {
                  const bit = Permission[name];
                  const { label } = PERMISSION_LABELS[name];
                  const state = getState(ow.targetType, ow.targetId, bit);
                  return (
                    <div key={name} className="flex items-center justify-between py-0.5">
                      <span className="text-xs">{label}</span>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => void toggleState(ow.targetType, ow.targetId, bit, state)}
                          aria-label={`${label}: ${state}. Click to cycle.`}
                          className={cn(
                            "flex size-6 items-center justify-center rounded text-xs transition-colors",
                            state === "allow" && "bg-success/20 text-success",
                            state === "deny" && "bg-destructive/20 text-destructive",
                            state === "inherit" && "bg-muted text-muted-foreground",
                          )}
                        >
                          {state === "allow" ? <Check className="size-3.5" aria-hidden /> : state === "deny" ? <X className="size-3.5" aria-hidden /> : <Minus className="size-3.5" aria-hidden />}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
