import { Navigate, useParams } from "react-router";
import { Hash } from "lucide-react";
import { useWorkspace } from "@/lib/queries";
import { EmptyState } from "@/components/common/EmptyState";
import { FullscreenSpinner } from "@/components/common/FullscreenSpinner";

const LAST_CHANNEL = (ws: string) => `chat.lastChannel.${ws}`;
export function rememberChannel(workspaceId: string, channelId: string) {
  localStorage.setItem(LAST_CHANNEL(workspaceId), channelId);
}

export function WorkspaceIndexRoute() {
  const { workspaceId } = useParams();
  const ws = useWorkspace(workspaceId);
  if (!ws.data) return <FullscreenSpinner />;
  const last = localStorage.getItem(LAST_CHANNEL(workspaceId!));
  const target = ws.data.channels.find((c) => c.id === last) ?? ws.data.channels.find((c) => c.kind === "text") ?? ws.data.channels[0];
  if (target) return <Navigate to={`/w/${workspaceId}/c/${target.id}`} replace />;
  return <EmptyState icon={Hash} title="No channels yet" description="Once a channel exists that you can see, it will open here." />;
}
