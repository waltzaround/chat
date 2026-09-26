import { useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import { Loader2, Users } from "lucide-react";
import { useAcceptInvite, useInvitePreview, useMe } from "@/lib/queries";
import { errorMessage, isApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/common/UserAvatar";
import { WorkspaceIcon } from "@/components/workspace/WorkspaceIcon";
import { toast } from "sonner";
import { rememberInvite } from "@/lib/signup-cookies";

export function InvitePage() {
  const { code } = useParams();
  const navigate = useNavigate();
  const preview = useInvitePreview(code);
  const me = useMe();
  const accept = useAcceptInvite();

  const signedIn = me.isSuccess;

  // Lets the holder create an account even when this server is invite-only.
  useEffect(() => {
    if (code && preview.isSuccess) rememberInvite(code);
  }, [code, preview.isSuccess]);

  const join = async () => {
    if (!code) return;
    if (!signedIn) {
      navigate(`/register?next=${encodeURIComponent(`/invite/${code}`)}`);
      return;
    }
    try {
      const res = await accept.mutateAsync(code);
      navigate(`/w/${res.workspaceId}`, { replace: true });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-rail p-4">
      <div className="w-full max-w-sm rounded-lg border bg-card p-6 text-center shadow-sm">
        {preview.isPending ? (
          <div className="flex justify-center py-10 text-muted-foreground">
            <Loader2 className="size-6 animate-spin" aria-label="Loading invite" />
          </div>
        ) : preview.isError ? (
          <>
            <h1 className="text-lg font-semibold">Invite unavailable</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {isApiError(preview.error) ? preview.error.message : "This invite link is invalid or has expired."}
            </p>
            <Button className="mt-6 w-full" variant="outline" onClick={() => navigate("/")}>
              Go home
            </Button>
          </>
        ) : (
          <>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {preview.data.inviter ? `${preview.data.inviter.displayName} invited you to join` : "You have been invited to join"}
            </p>
            <div className="mt-4 flex justify-center">
              <WorkspaceIcon workspace={preview.data.workspace} size="xl" />
            </div>
            <h1 className="mt-3 text-xl font-semibold">{preview.data.workspace.name}</h1>
            <p className="mt-1 flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
              <Users className="size-3.5" aria-hidden />
              {preview.data.workspace.memberCount} {preview.data.workspace.memberCount === 1 ? "member" : "members"}
            </p>
            {preview.data.inviter ? (
              <div className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <UserAvatar user={preview.data.inviter} size="sm" />
                <span>Invited by {preview.data.inviter.displayName}</span>
              </div>
            ) : null}
            <Button className="mt-6 w-full" onClick={join} disabled={accept.isPending || me.isPending}>
              {accept.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {preview.data.isMember ? "Open workspace" : signedIn ? "Accept invite" : "Create an account to join"}
            </Button>
            {!signedIn && !me.isPending ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Already have an account?{" "}
                <button type="button" className="text-primary hover:underline" onClick={() => navigate(`/login?next=${encodeURIComponent(`/invite/${code}`)}`)}>
                  Sign in
                </button>
              </p>
            ) : null}
            {preview.data.expiresAt ? <p className="mt-3 text-[11px] text-muted-foreground">Expires {new Date(preview.data.expiresAt).toLocaleString()}</p> : null}
          </>
        )}
      </div>
    </main>
  );
}
