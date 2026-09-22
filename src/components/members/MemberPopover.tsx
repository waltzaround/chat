import { useState, type ReactNode } from "react";
import { Crown, ShieldBan, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/common/UserAvatar";
import { STATUS_LABEL } from "@/components/common/StatusDot";
import { useMe, useMemberMutations, useWorkspace } from "@/lib/queries";
import { usePresence } from "@/realtime/hooks";
import { Permission, can, canModerateMember, memberDisplayName } from "@/lib/permissions";
import { errorMessage } from "@/lib/api";
import type { Member } from "@shared/types";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

export function MemberPopover({ member, workspaceId, children }: { member: Member; workspaceId: string; children: ReactNode }) {
  const ws = useWorkspace(workspaceId);
  const me = useMe();
  const presence = usePresence(member.userId);
  const actions = useMemberMutations(workspaceId);
  const [confirm, setConfirm] = useState<"kick" | "ban" | null>(null);
  const roles = (ws.data?.roles ?? []).filter((r) => !r.isDefault && member.roleIds.includes(r.id)).sort((a, b) => b.position - a.position);
  const isMe = me.data?.id === member.userId;
  const canMod = !!ws.data && !!me.data && !isMe && canModerateMember(ws.data, me.data.id, ws.data.myRoleIds, member);
  const canKick = canMod && can(ws.data, Permission.KICK_MEMBERS);
  const canBan = canMod && can(ws.data, Permission.BAN_MEMBERS);

  const run = async () => {
    try {
      if (confirm === "kick") await actions.kick.mutateAsync(member.userId);
      if (confirm === "ban") await actions.ban.mutateAsync({ userId: member.userId });
      toast.success(`${memberDisplayName(member)} was ${confirm === "kick" ? "removed" : "banned"}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setConfirm(null);
    }
  };

  return (
    <>
      <Popover>
        <PopoverTrigger asChild>{children}</PopoverTrigger>
        <PopoverContent side="left" align="start" className="w-72 p-0">
          <div className="h-14 rounded-t-md" style={{ background: `oklch(0.45 0.1 ${hue(member.userId)})` }} aria-hidden />
          <div className="-mt-8 px-4">
            <UserAvatar user={member} size="xl" status={presence} className="rounded-full ring-4 ring-popover" />
          </div>
          <div className="space-y-3 p-4 pt-2">
            <div>
              <p className="flex items-center gap-1.5 text-base font-semibold leading-tight">
                {memberDisplayName(member)}
                {member.isOwner ? <Crown className="size-3.5 text-warning" aria-label="Workspace owner" /> : null}
              </p>
              <p className="text-xs text-muted-foreground">
                {member.nickname ? `${member.displayName} · ` : ""}@{member.username} · {STATUS_LABEL[presence]}
              </p>
            </div>
            {member.bio ? <p className="text-sm leading-snug whitespace-pre-wrap">{member.bio}</p> : null}
            {roles.length ? (
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Roles</p>
                <div className="flex flex-wrap gap-1">
                  {roles.map((r) => (
                    <Badge key={r.id} variant="outline" className="gap-1.5 font-normal">
                      <span className="size-2 rounded-full" style={{ background: r.colour ?? "var(--muted-foreground)" }} aria-hidden />
                      {r.name}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
            {member.timeoutUntil && new Date(member.timeoutUntil) > new Date() ? (
              <p className="text-xs text-warning">Timed out until {new Date(member.timeoutUntil).toLocaleString()}</p>
            ) : null}
            <p className="text-[11px] text-muted-foreground">Member since {new Date(member.joinedAt).toLocaleDateString()}</p>
            {canKick || canBan ? (
              <div className="flex gap-2 border-t pt-3">
                {canKick ? (
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => setConfirm("kick")}>
                    <UserMinus className="size-3.5" aria-hidden /> Kick
                  </Button>
                ) : null}
                {canBan ? (
                  <Button size="sm" variant="destructive" className="flex-1" onClick={() => setConfirm("ban")}>
                    <ShieldBan className="size-3.5" aria-hidden /> Ban
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>
      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "ban" ? "Ban" : "Kick"} {memberDisplayName(member)}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "ban" ? "They will be removed and will not be able to rejoin with an invite until unbanned." : "They will be removed from the workspace but can rejoin with a new invite."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => void run()}>
              {confirm === "ban" ? "Ban member" : "Kick member"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function hue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}
