import { useEffect } from "react";
import { Outlet, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { useMe, useWorkspace } from "@/lib/queries";
import { isApiError } from "@/lib/api";
import { RealtimeProvider } from "@/realtime/RealtimeProvider";
import { useSocketStatus } from "@/realtime/hooks";
import { AppShell } from "./AppShell";
import { LayoutProvider } from "./layout-context";
import { rememberWorkspace } from "@/routes/RootRedirect";
import { FullscreenSpinner } from "@/components/common/FullscreenSpinner";
import { ErrorState } from "@/components/common/ErrorState";
import { Button } from "@/components/ui/button";
import { VoiceProvider } from "@/components/voice/VoiceProvider";

export function WorkspaceLayout() {
  const { workspaceId } = useParams();
  const me = useMe();
  const workspace = useWorkspace(workspaceId);
  const navigate = useNavigate();

  useEffect(() => {
    if (workspaceId && workspace.isSuccess) rememberWorkspace(workspaceId);
  }, [workspaceId, workspace.isSuccess]);

  if (!workspaceId || !me.data) return <FullscreenSpinner />;
  if (workspace.isPending) return <FullscreenSpinner label="Opening workspace…" />;
  if (workspace.isError) {
    const notFound = isApiError(workspace.error) && workspace.error.status === 404;
    return (
      <ErrorState
        fullscreen
        title={notFound ? "You are not a member of this workspace" : "Could not open this workspace"}
        description={notFound ? "It may have been deleted, or your invite may have been revoked." : undefined}
        onRetry={notFound ? undefined : () => void workspace.refetch()}
        action={
          <Button size="sm" onClick={() => navigate("/")}>
            Back to my workspaces
          </Button>
        }
      />
    );
  }

  return (
    <RealtimeProvider key={workspaceId} workspaceId={workspaceId} userId={me.data.id}>
      <FatalWatcher />
      <LayoutProvider>
        <VoiceProvider>
          <AppShell>
            <Outlet />
          </AppShell>
        </VoiceProvider>
      </LayoutProvider>
    </RealtimeProvider>
  );
}

function FatalWatcher() {
  const { fatal } = useSocketStatus();
  const navigate = useNavigate();
  useEffect(() => {
    if (!fatal) return;
    if (fatal.reason === "kicked" || fatal.reason === "banned") {
      toast.error(fatal.reason === "banned" ? "You were banned from this workspace" : "You were removed from this workspace");
      navigate("/", { replace: true });
    } else if (fatal.code === 4001) {
      navigate("/login", { replace: true });
    }
  }, [fatal, navigate]);
  return null;
}
