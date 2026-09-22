import { Navigate } from "react-router";
import { useWorkspaces } from "@/lib/queries";
import { FullscreenSpinner } from "@/components/common/FullscreenSpinner";
import { ErrorState } from "@/components/common/ErrorState";

const LAST_KEY = "commons.lastWorkspace";

export function rememberWorkspace(id: string) {
  localStorage.setItem(LAST_KEY, id);
}

export function RootRedirect() {
  const workspaces = useWorkspaces();
  if (workspaces.isPending) return <FullscreenSpinner />;
  if (workspaces.isError) return <ErrorState title="Could not load your workspaces" onRetry={() => void workspaces.refetch()} fullscreen />;
  if (workspaces.data.length === 0) return <Navigate to="/welcome" replace />;
  const last = localStorage.getItem(LAST_KEY);
  const target = workspaces.data.find((w) => w.id === last) ?? workspaces.data[0]!;
  return <Navigate to={`/w/${target.id}`} replace />;
}
