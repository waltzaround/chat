import { useCallback, useEffect, useState } from "react";
import { useRealtime } from "@/realtime/RealtimeProvider";
import { Permission, hasPermission } from "@/lib/permissions";
import { ChannelHeader } from "./ChannelHeader";
import { MessageList } from "./MessageList";
import { MessageComposer, type ComposerReply } from "./MessageComposer";
import { TypingIndicator } from "./TypingIndicator";
import { DmHeaderMenu } from "@/components/dms/DmHeaderMenu";
import { PinnedMessagesButton } from "./PinnedMessages";
import { useBlockedIds } from "@/lib/queries";
import type { Channel, Message, WorkspaceDetail } from "@shared/types";

export function TextChannelView({ channel, workspace, embedded }: { channel: Channel; workspace: WorkspaceDetail; embedded?: boolean }) {
  const rt = useRealtime();
  const [reply, setReply] = useState<ComposerReply | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);

  useEffect(() => {
    rt.subscribeChannel(channel.id);
  }, [rt, channel.id]);

  const onReply = useCallback((m: Message) => {
    setEditing(null);
    setReply({ id: m.id, author: m.author, content: m.content, deleted: false });
  }, []);
  const onEdit = useCallback((m: Message) => {
    setReply(null);
    setEditing(m);
  }, []);

  const canSend = hasPermission(channel.permissions, Permission.SEND_MESSAGES);
  const blocked = useBlockedIds();

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!embedded ? (
        <ChannelHeader
          channel={channel}
          dmPeer={workspace.kind === "dm" ? workspace.dmPeer : undefined}
          actions={
            <>
              <PinnedMessagesButton channelId={channel.id} />
              {workspace.kind === "dm" ? <DmHeaderMenu workspaceId={workspace.id} peer={workspace.dmPeer} /> : null}
            </>
          }
        />
      ) : null}
      <MessageList key={channel.id} channel={channel} workspace={workspace} onReply={onReply} onEdit={onEdit} editingId={editing?.id ?? null} />
      <div className="shrink-0 px-4 pb-4">
        <MessageComposer
          channel={channel}
          reply={reply}
          onClearReply={() => setReply(null)}
          editing={editing}
          onDoneEditing={() => setEditing(null)}
          disabled={!canSend}
          placeholderName={workspace.kind === "dm" ? `@${workspace.dmPeer?.displayName ?? "Deleted user"}` : undefined}
          disabledReason={
            workspace.kind === "dm" && !canSend
              ? workspace.dmPeer && blocked.has(workspace.dmPeer.id)
                ? `You blocked ${workspace.dmPeer.displayName}. Unblock them to message.`
                : "You can't message this person."
              : undefined
          }
        />
        <TypingIndicator channelId={channel.id} workspaceId={workspace.id} />
      </div>
    </div>
  );
}
