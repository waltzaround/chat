import { useEffect, useState } from "react";
import { MessageSquare, PanelRightClose } from "lucide-react";
import { useLayout } from "@/app/layout-context";
import { useRealtime } from "@/realtime/RealtimeProvider";
import { ChannelHeader, HeaderButton } from "@/components/chat/ChannelHeader";
import { TextChannelView } from "@/components/chat/TextChannelView";
import { VoiceRoom } from "./VoiceRoom";
import { cn } from "@/lib/utils";
import type { Channel, WorkspaceDetail } from "@shared/types";

/**
 * A voice channel page: the media stage is primary, the room's text chat sits
 * in a collapsible side panel (or toggles with the stage on small screens).
 */
export function VoiceChannelView({ channel, workspace }: { channel: Channel; workspace: WorkspaceDetail }) {
  const { viewport } = useLayout();
  const rt = useRealtime();
  const small = viewport !== "desktop";
  const [chatOpen, setChatOpen] = useState(() => localStorage.getItem("commons.voiceChat") !== "false");
  const [mobileTab, setMobileTab] = useState<"media" | "chat">("media");

  useEffect(() => {
    localStorage.setItem("commons.voiceChat", String(chatOpen));
  }, [chatOpen]);

  // Subscribe to the room chat even when the panel is closed so unread state stays accurate.
  useEffect(() => {
    rt.subscribeChannel(channel.id);
  }, [rt, channel.id]);

  const showChat = small ? mobileTab === "chat" : chatOpen;
  const showMedia = small ? mobileTab === "media" : true;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ChannelHeader
        channel={channel}
        actions={
          small ? (
            <HeaderButton label={mobileTab === "chat" ? "Show media" : "Show chat"} onClick={() => setMobileTab((t) => (t === "chat" ? "media" : "chat"))} pressed={mobileTab === "chat"}>
              <MessageSquare className="size-[18px]" aria-hidden />
            </HeaderButton>
          ) : (
            <HeaderButton label={chatOpen ? "Hide room chat" : "Show room chat"} onClick={() => setChatOpen((v) => !v)} pressed={chatOpen}>
              {chatOpen ? <PanelRightClose className="size-[18px]" aria-hidden /> : <MessageSquare className="size-[18px]" aria-hidden />}
            </HeaderButton>
          )
        }
      />
      <div className="flex min-h-0 flex-1">
        {showMedia ? (
          <div className="min-w-0 flex-1 bg-rail">
            <VoiceRoom channel={channel} workspace={workspace} />
          </div>
        ) : null}
        {showChat ? (
          <aside className={cn("flex min-h-0 flex-col border-l bg-background", small ? "flex-1" : "w-[360px] shrink-0")} aria-label={`Chat in ${channel.name}`}>
            <TextChannelView channel={channel} workspace={workspace} embedded />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
