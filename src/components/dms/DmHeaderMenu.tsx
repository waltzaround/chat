import { useNavigate } from "react-router";
import { Ban, MoreHorizontal, X } from "lucide-react";
import { toast } from "sonner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { HeaderButton } from "@/components/chat/ChannelHeader";
import { useBlockedIds, useCloseDm, useSetBlocked } from "@/lib/queries";
import { errorMessage } from "@/lib/api";
import type { UserSummary } from "@shared/types";

/** The "…" menu in a direct message's header: block or unblock, and close the conversation. */
export function DmHeaderMenu({ workspaceId, peer }: { workspaceId: string; peer: UserSummary | null }) {
  const blocked = useBlockedIds();
  const setBlocked = useSetBlocked();
  const close = useCloseDm();
  const navigate = useNavigate();
  const isBlocked = !!peer && blocked.has(peer.id);

  const toggleBlock = () => {
    if (!peer) return;
    setBlocked.mutate(
      { userId: peer.id, blocked: !isBlocked },
      {
        onSuccess: () => toast.success(isBlocked ? `Unblocked ${peer.displayName}` : `Blocked ${peer.displayName}. Neither of you can send messages here now.`),
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <span>
          <HeaderButton label="Conversation options" onClick={() => undefined}>
            <MoreHorizontal className="size-[18px]" aria-hidden />
          </HeaderButton>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem
          onSelect={() =>
            close.mutate(workspaceId, {
              onSuccess: () => navigate("/dms"),
              onError: (err) => toast.error(errorMessage(err)),
            })
          }
        >
          <X /> Close conversation
        </DropdownMenuItem>
        {peer ? (
          <DropdownMenuItem variant={isBlocked ? "default" : "destructive"} onSelect={toggleBlock}>
            <Ban /> {isBlocked ? `Unblock ${peer.displayName}` : `Block ${peer.displayName}`}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
