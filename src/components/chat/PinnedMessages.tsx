import { useState } from "react";
import { useSearchParams } from "react-router";
import { Pin } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { UserAvatar } from "@/components/common/UserAvatar";
import { HeaderButton } from "./ChannelHeader";
import { Markdown } from "./Markdown";
import { usePins } from "@/lib/queries";
import { formatFull } from "@/lib/format";

/** Header button listing the channel's pinned messages, newest pin first. */
export function PinnedMessagesButton({ channelId }: { channelId: string }) {
  const [open, setOpen] = useState(false);
  const pins = usePins(channelId, open);
  const [, setParams] = useSearchParams();
  const jump = (sequence: number) => {
    setOpen(false);
    setParams({ m: String(sequence) });
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <span>
          <HeaderButton label="Pinned messages" onClick={() => undefined} pressed={open}>
            <Pin className="size-[18px]" aria-hidden />
          </HeaderButton>
        </span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <p className="border-b px-3 py-2 text-sm font-semibold">Pinned messages</p>
        <ul className="max-h-96 overflow-y-auto">
          {pins.isPending ? (
            <li className="p-4 text-center text-sm text-muted-foreground">Loading…</li>
          ) : pins.data?.length ? (
            pins.data.map((m) => (
              <li key={m.id} className="border-b last:border-0">
                <button type="button" onClick={() => jump(m.sequence)} className="flex w-full gap-2.5 px-3 py-2.5 text-left hover:bg-accent">
                <UserAvatar user={m.author} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs">
                    <span className="font-semibold">{m.author.nickname ?? m.author.displayName}</span>{" "}
                    <span className="text-muted-foreground">{formatFull(m.createdAt)}</span>
                  </p>
                  <div className="message-body line-clamp-4 text-sm">{m.content ? <Markdown content={m.content} /> : <span className="italic text-muted-foreground">Attachment</span>}</div>
                </div>
                </button>
              </li>
            ))
          ) : (
            <li className="p-4 text-center text-sm text-muted-foreground">Nothing pinned yet. Pin a message from its ••• menu.</li>
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
