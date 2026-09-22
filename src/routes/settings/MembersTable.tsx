import { useState } from "react";
import { MoreHorizontal, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserAvatar } from "@/components/common/UserAvatar";
import { useMembers, useMemberMutations, useRoleMutations } from "@/lib/queries";
import { can, canModerateMember, memberDisplayName, Permission } from "@/lib/permissions";
import { errorMessage } from "@/lib/api";
import { formatFull } from "@/lib/format";
import { roleColour } from "@/lib/permissions";
import type { Member, WorkspaceDetail } from "@shared/types";

interface MembersTableProps {
  ws: WorkspaceDetail;
  meId: string;
}

type DialogState =
  | null
  | { type: "roles"; member: Member }
  | { type: "nickname"; member: Member }
  | { type: "timeout"; member: Member }
  | { type: "ban"; member: Member };

const TIMEOUT_OPTIONS = [
  { label: "5 minutes", value: 5 * 60 * 1000 },
  { label: "1 hour", value: 60 * 60 * 1000 },
  { label: "1 day", value: 24 * 60 * 60 * 1000 },
  { label: "Remove timeout", value: 0 },
];

export function MembersTable({ ws, meId }: MembersTableProps) {
  const { data: members = [] } = useMembers(ws.id);
  const memberMuts = useMemberMutations(ws.id);
  const roleMuts = useRoleMutations(ws.id);

  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [kickTarget, setKickTarget] = useState<Member | null>(null);

  const myRoleIds = ws.myRoleIds;
  const canManageRoles = can(ws, Permission.MANAGE_ROLES);
  const canKick = can(ws, Permission.KICK_MEMBERS);
  const canBan = can(ws, Permission.BAN_MEMBERS);

  const filtered = members.filter((m) => {
    const q = search.toLowerCase();
    return (
      memberDisplayName(m).toLowerCase().includes(q) ||
      m.username.toLowerCase().includes(q)
    );
  });

  return (
    <>
      <div className="mb-3 relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search members…"
          className="pl-8"
          aria-label="Search members"
        />
      </div>

      <div className="rounded-md border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/30">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Member</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Roles</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Joined</th>
              <th className="w-10 px-2" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((member, idx) => {
              const colour = roleColour(member.roleIds, ws.roles);
              const canMod = canModerateMember(ws, meId, myRoleIds, member);
              const memberRoles = ws.roles.filter((r) => !r.isDefault && member.roleIds.includes(r.id));

              return (
                <tr key={member.userId} className={idx % 2 === 0 ? "bg-background" : "bg-muted/10"}>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <UserAvatar
                        user={{ id: member.userId, displayName: member.displayName, avatarUrl: member.avatarUrl }}
                        size="sm"
                      />
                      <div>
                        <p className="font-medium" style={colour ? { color: colour } : {}}>
                          {memberDisplayName(member)}
                          {member.isOwner && <span className="ml-1 text-xs text-muted-foreground">(Owner)</span>}
                        </p>
                        <p className="text-xs text-muted-foreground">@{member.username}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {memberRoles.slice(0, 3).map((r) => (
                        <Badge
                          key={r.id}
                          variant="outline"
                          className="text-xs px-1.5 py-0"
                          style={r.colour ? { borderColor: r.colour, color: r.colour } : {}}
                        >
                          {r.name}
                        </Badge>
                      ))}
                      {memberRoles.length > 3 && (
                        <Badge variant="outline" className="text-xs px-1.5 py-0">+{memberRoles.length - 3}</Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                    {formatFull(member.joinedAt)}
                  </td>
                  <td className="px-2 py-2">
                    {canMod && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            aria-label={`Actions for ${memberDisplayName(member)}`}
                          >
                            <MoreHorizontal className="size-4" aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Actions</DropdownMenuLabel>
                          {canManageRoles && (
                            <DropdownMenuItem onClick={() => setDialog({ type: "roles", member })}>
                              Manage roles
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => setDialog({ type: "nickname", member })}>
                            Set nickname
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setDialog({ type: "timeout", member })}>
                            Timeout
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {canKick && (
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => setKickTarget(member)}
                            >
                              Kick
                            </DropdownMenuItem>
                          )}
                          {canBan && (
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => setDialog({ type: "ban", member })}
                            >
                              Ban
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">No members found.</p>
        )}
      </div>

      {/* Roles dialog */}
      {dialog?.type === "roles" && (
        <ManageRolesDialog
          member={dialog.member}
          ws={ws}
          onClose={() => setDialog(null)}
          setMemberRoles={roleMuts.setMemberRoles}
        />
      )}

      {/* Nickname dialog */}
      {dialog?.type === "nickname" && (
        <NicknameDialog
          member={dialog.member}
          onClose={() => setDialog(null)}
          update={memberMuts.update}
        />
      )}

      {/* Timeout dialog */}
      {dialog?.type === "timeout" && (
        <TimeoutDialog
          member={dialog.member}
          onClose={() => setDialog(null)}
          update={memberMuts.update}
        />
      )}

      {/* Ban dialog */}
      {dialog?.type === "ban" && (
        <BanDialog
          member={dialog.member}
          onClose={() => setDialog(null)}
          ban={memberMuts.ban}
        />
      )}

      {/* Kick confirm */}
      {kickTarget && (
        <AlertDialog open onOpenChange={(o) => !o && setKickTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Kick {memberDisplayName(kickTarget)}?</AlertDialogTitle>
              <AlertDialogDescription>
                They will be removed from the workspace but can rejoin with an invite.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setKickTarget(null)}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={async () => {
                  try {
                    await memberMuts.kick.mutateAsync(kickTarget.userId);
                    toast.success(`Kicked ${memberDisplayName(kickTarget)}`);
                    setKickTarget(null);
                  } catch (err) {
                    toast.error(errorMessage(err));
                  }
                }}
              >
                Kick
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}

function ManageRolesDialog({
  member, ws, onClose, setMemberRoles,
}: {
  member: Member;
  ws: WorkspaceDetail;
  onClose: () => void;
  setMemberRoles: ReturnType<typeof useRoleMutations>["setMemberRoles"];
}) {
  const assignableRoles = ws.roles.filter((r) => !r.isDefault);
  const [selected, setSelected] = useState<Set<string>>(new Set(member.roleIds.filter((id) => assignableRoles.some((r) => r.id === id))));

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    try {
      await setMemberRoles.mutateAsync({ userId: member.userId, roleIds: Array.from(selected) });
      toast.success("Roles updated");
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manage roles — {memberDisplayName(member)}</DialogTitle>
          <DialogDescription>Toggle roles for this member.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 py-2 max-h-64 overflow-y-auto">
          {assignableRoles.map((role) => (
            <label key={role.id} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-accent">
              <Checkbox
                checked={selected.has(role.id)}
                onCheckedChange={() => toggle(role.id)}
                id={`role-check-${role.id}`}
              />
              <span
                className="size-2.5 rounded-full border border-border shrink-0"
                style={role.colour ? { backgroundColor: role.colour } : {}}
                aria-hidden
              />
              <span className="text-sm">{role.name}</span>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="button" onClick={() => void handleSave()} disabled={setMemberRoles.isPending}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NicknameDialog({
  member, onClose, update,
}: {
  member: Member;
  onClose: () => void;
  update: ReturnType<typeof useMemberMutations>["update"];
}) {
  const [nick, setNick] = useState(member.nickname ?? "");

  const handleSave = async () => {
    try {
      await update.mutateAsync({ userId: member.userId, nickname: nick.trim() || null });
      toast.success("Nickname updated");
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Set nickname — {member.displayName}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-1.5 py-2">
          <Label htmlFor="nick-input">Nickname</Label>
          <Input
            id="nick-input"
            value={nick}
            onChange={(e) => setNick(e.target.value)}
            maxLength={32}
            placeholder={member.displayName}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="button" onClick={() => void handleSave()} disabled={update.isPending}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TimeoutDialog({
  member, onClose, update,
}: {
  member: Member;
  onClose: () => void;
  update: ReturnType<typeof useMemberMutations>["update"];
}) {
  const [duration, setDuration] = useState("3600000");

  const handleApply = async () => {
    const ms = Number(duration);
    const until = ms === 0 ? null : new Date(Date.now() + ms).toISOString();
    try {
      await update.mutateAsync({ userId: member.userId, timeoutUntil: until });
      toast.success(ms === 0 ? "Timeout removed" : `Timeout applied`);
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Timeout — {memberDisplayName(member)}</DialogTitle>
          <DialogDescription>The member cannot send messages while timed out.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5 py-2">
          <Label htmlFor="timeout-duration">Duration</Label>
          <Select value={duration} onValueChange={setDuration}>
            <SelectTrigger id="timeout-duration">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMEOUT_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="button" onClick={() => void handleApply()} disabled={update.isPending}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BanDialog({
  member, onClose, ban,
}: {
  member: Member;
  onClose: () => void;
  ban: ReturnType<typeof useMemberMutations>["ban"];
}) {
  const [reason, setReason] = useState("");
  const [deleteMessages, setDeleteMessages] = useState(false);

  const handleBan = async () => {
    try {
      await ban.mutateAsync({ userId: member.userId, reason: reason.trim() || null, deleteRecentMessages: deleteMessages });
      toast.success(`Banned ${memberDisplayName(member)}`);
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Ban {memberDisplayName(member)}?</DialogTitle>
          <DialogDescription>They will be permanently removed and cannot rejoin.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="ban-reason">Reason (optional)</Label>
            <Input
              id="ban-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={256}
              placeholder="Rule violation…"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={deleteMessages}
              onCheckedChange={(c) => setDeleteMessages(c === true)}
              id="ban-delete-messages"
            />
            Delete recent messages
          </label>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="button" variant="destructive" onClick={() => void handleBan()} disabled={ban.isPending}>Ban</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
