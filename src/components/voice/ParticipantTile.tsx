import { useEffect, useRef } from "react";
import { MicOff, Monitor, MonitorOff } from "lucide-react";
import { UserAvatar } from "@/components/common/UserAvatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface TileParticipant {
  key: string;
  peerId: string;
  userId: string;
  name: string;
  avatarUrl: string | null;
  roleColour: string | null;
  isSelf: boolean;
  audioEnabled: boolean;
  videoEnabled: boolean;
  videoTrack: MediaStreamTrack | null;
  screenShareEnabled: boolean;
  screenTrack: MediaStreamTrack | null;
}

/** Renders a MediaStreamTrack into a <video>. */
export function VideoTrack({ track, mirror, className, contain }: { track: MediaStreamTrack | null; mirror?: boolean; className?: string; contain?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!track) {
      el.srcObject = null;
      return;
    }
    el.srcObject = new MediaStream([track]);
    el.play().catch(() => undefined);
    return () => {
      el.srcObject = null;
    };
  }, [track]);
  return <video ref={ref} autoPlay playsInline muted className={cn("size-full bg-black", contain ? "object-contain" : "object-cover", mirror && "[transform:scaleX(-1)]", className)} />;
}

export function ParticipantTile({ participant: p, speaking, large, onSelect }: { participant: TileParticipant; speaking: boolean; large?: boolean; onSelect?: () => void }) {
  const Wrapper = onSelect ? "button" : "div";
  return (
    <Wrapper
      type={onSelect ? "button" : undefined}
      onClick={onSelect}
      aria-label={onSelect ? `Focus ${p.name}` : undefined}
      className={cn(
        "relative flex size-full items-center justify-center overflow-hidden rounded-lg border bg-card text-left transition-shadow",
        speaking ? "border-success ring-2 ring-success/60" : "border-border",
        onSelect && "cursor-pointer hover:border-foreground/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
      )}
    >
      {p.videoEnabled && p.videoTrack ? (
        <VideoTrack track={p.videoTrack} mirror={p.isSelf} contain={large} />
      ) : (
        <UserAvatar user={{ id: p.userId, displayName: p.name, avatarUrl: p.avatarUrl }} size={large ? "xl" : "lg"} className={cn(large && "scale-125")} />
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-6 text-xs text-white">
        <span className="min-w-0 truncate font-medium" style={p.roleColour ? { color: p.roleColour } : undefined}>
          {p.name}
          {p.isSelf ? " (you)" : ""}
        </span>
        {!p.audioEnabled ? <MicOff className="size-3.5 shrink-0 text-white/80" aria-label="Muted" /> : null}
        {p.screenShareEnabled ? <Monitor className="size-3.5 shrink-0 text-success" aria-label="Sharing screen" /> : null}
      </div>
      {speaking ? <span className="sr-only">{p.name} is speaking</span> : null}
    </Wrapper>
  );
}

export function ScreenShareTile({ participant: p, large, onSelect, onStop }: { participant: TileParticipant; large?: boolean; onSelect?: () => void; onStop?: () => void }) {
  const Wrapper = onSelect ? "button" : "div";
  return (
    <Wrapper
      type={onSelect ? "button" : undefined}
      onClick={onSelect}
      aria-label={onSelect ? `Focus ${p.name}'s screen` : undefined}
      className={cn("relative flex size-full items-center justify-center overflow-hidden rounded-lg border bg-black text-left", onSelect && "cursor-pointer hover:border-foreground/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none")}
    >
      <VideoTrack track={p.screenTrack} contain />
      <div className="absolute top-2 left-2 flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 text-xs text-white">
        <Monitor className="size-3.5 text-success" aria-hidden />
        <span>{p.isSelf ? "You are sharing your screen" : `${p.name}'s screen`}</span>
      </div>
      {onStop && large ? (
        <Button size="sm" variant="destructive" onClick={onStop} className="absolute top-2 right-2">
          <MonitorOff className="size-3.5" aria-hidden /> Stop sharing
        </Button>
      ) : null}
    </Wrapper>
  );
}
