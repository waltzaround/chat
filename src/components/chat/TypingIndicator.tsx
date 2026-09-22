import { useTyping } from "@/realtime/hooks";
import { useMembers } from "@/lib/queries";
import { memberDisplayName } from "@/lib/permissions";

export function TypingIndicator({ channelId, workspaceId }: { channelId: string; workspaceId: string }) {
  const userIds = useTyping(channelId);
  const members = useMembers(workspaceId);
  const names = userIds.map((id) => {
    const m = members.data?.find((x) => x.userId === id);
    return m ? memberDisplayName(m) : "Someone";
  });
  let text = "";
  if (names.length === 1) text = `${names[0]} is typing…`;
  else if (names.length === 2) text = `${names[0]} and ${names[1]} are typing…`;
  else if (names.length > 2) text = "Several people are typing…";

  return (
    <div className="h-5 px-1 pt-1 text-xs text-muted-foreground" aria-live="polite" aria-atomic="true">
      {text ? (
        <span className="flex items-center gap-1.5">
          <span className="flex gap-0.5" aria-hidden>
            <span className="size-1 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
            <span className="size-1 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
            <span className="size-1 animate-bounce rounded-full bg-current" />
          </span>
          {text}
        </span>
      ) : null}
    </div>
  );
}
