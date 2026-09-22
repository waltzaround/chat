import { useEffect } from "react";
import { useParams } from "react-router";
import { Hash } from "lucide-react";
import { useWorkspace } from "@/lib/queries";
import { EmptyState } from "@/components/common/EmptyState";
import { FullscreenSpinner } from "@/components/common/FullscreenSpinner";
import { TextChannelView } from "@/components/chat/TextChannelView";
import { VoiceChannelView } from "@/components/voice/VoiceChannelView";
import { rememberChannel } from "./WorkspaceIndexRoute";

export function ChannelRoute() {
  const { workspaceId, channelId } = useParams();
  const ws = useWorkspace(workspaceId);
  const channel = ws.data?.channels.find((c) => c.id === channelId);

  useEffect(() => {
    if (workspaceId && channelId && channel) rememberChannel(workspaceId, channelId);
  }, [workspaceId, channelId, channel]);

  if (ws.isPending) return <FullscreenSpinner />;
  if (!channel) {
    return (
      <EmptyState
        icon={Hash}
        title="Channel unavailable"
        description="This channel does not exist, was deleted, or you do not have permission to view it."
      />
    );
  }
  if (channel.kind === "voice") return <VoiceChannelView key={channel.id} channel={channel} workspace={ws.data!} />;
  return <TextChannelView key={channel.id} channel={channel} workspace={ws.data!} />;
}
