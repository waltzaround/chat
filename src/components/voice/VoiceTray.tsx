import { useNavigate, useParams } from "react-router";
import { Headphones, HeadphoneOff, Loader2, Mic, MicOff, Monitor, MonitorOff, PhoneOff, Settings2, Signal, Video, VideoOff, X } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { useVoice } from "./VoiceProvider";

/**
 * Persistent bottom bar while connected to (or reconnecting to) a voice room.
 * Also offers to rejoin the previous room after a page refresh.
 */
export function VoiceTray() {
  const voice = useVoice();
  const { workspaceId } = useParams();
  const ws = useWorkspace(workspaceId);
  const navigate = useNavigate();

  if (voice.status === "idle" && voice.rejoinOffer) {
    const ch = ws.data?.channels.find((c) => c.id === voice.rejoinOffer);
    if (!ch) return null;
    return (
      <div className="flex h-11 items-center gap-3 border-t bg-sidebar px-4 text-sm">
        <Signal className="size-4 text-muted-foreground" aria-hidden />
        <span className="flex-1 truncate">
          You were in <span className="font-medium">{ch.name}</span> before the page reloaded.
        </span>
        <Button size="sm" onClick={() => void voice.join(ch.id)}>
          Rejoin
        </Button>
        <Button size="sm" variant="ghost" onClick={voice.dismissRejoin} aria-label="Dismiss">
          <X className="size-4" aria-hidden />
        </Button>
      </div>
    );
  }
  if (voice.status === "idle" || !voice.channelId) return null;

  const channel = ws.data?.channels.find((c) => c.id === voice.channelId);
  const name = channel?.name ?? "voice";
  const connecting = voice.status === "connecting";

  return (
    <div className={cn("flex h-14 shrink-0 items-center gap-1 border-t bg-sidebar px-3", voice.status === "reconnecting" && "bg-warning/10")} role="region" aria-label="Voice controls">
      <button
        type="button"
        onClick={() => workspaceId && voice.channelId && navigate(`/w/${workspaceId}/c/${voice.channelId}`)}
        className="mr-2 flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-label={`Open ${name}`}
      >
        {connecting || voice.status === "reconnecting" ? <Loader2 className="size-4 animate-spin text-warning" aria-hidden /> : <Signal className="size-4 text-success" aria-hidden />}
        <span className="min-w-0 leading-tight">
          <span className={cn("block text-xs font-semibold", voice.status === "connected" ? "text-success" : "text-warning")}>
            {connecting ? "Connecting" : voice.status === "reconnecting" ? "Reconnecting" : "Voice connected"}
          </span>
          <span className="block truncate text-xs text-muted-foreground">{name}</span>
        </span>
      </button>
      <div className="ml-auto flex items-center gap-1">
        <TrayButton
          label={voice.muted ? "Unmute microphone" : "Mute microphone"}
          onClick={() => void voice.toggleMute()}
          active={voice.muted}
          disabled={!voice.canSpeak || connecting}
          hint={!voice.canSpeak ? "You do not have permission to speak here" : undefined}
        >
          {voice.muted ? <MicOff className="size-[18px]" aria-hidden /> : <Mic className="size-[18px]" aria-hidden />}
        </TrayButton>
        <TrayButton label={voice.deafened ? "Undeafen" : "Deafen"} onClick={() => void voice.toggleDeafen()} active={voice.deafened} disabled={connecting}>
          {voice.deafened ? <HeadphoneOff className="size-[18px]" aria-hidden /> : <Headphones className="size-[18px]" aria-hidden />}
        </TrayButton>
        <TrayButton
          label={voice.video ? "Turn camera off" : "Turn camera on"}
          onClick={() => void voice.toggleVideo()}
          highlight={voice.video}
          disabled={!voice.canVideo || connecting}
          hint={!voice.canVideo ? "You do not have permission to use video here" : undefined}
        >
          {voice.video ? <Video className="size-[18px]" aria-hidden /> : <VideoOff className="size-[18px]" aria-hidden />}
        </TrayButton>
        <TrayButton
          label={voice.screen ? "Stop screen sharing" : "Start screen sharing"}
          onClick={() => void voice.toggleScreenShare()}
          highlight={voice.screen}
          disabled={!voice.canScreenShare || connecting}
          hint={!voice.canScreenShare ? "You do not have permission to share your screen here" : undefined}
        >
          {voice.screen ? <MonitorOff className="size-[18px]" aria-hidden /> : <Monitor className="size-[18px]" aria-hidden />}
        </TrayButton>
        <TrayButton label="Voice settings" onClick={voice.openDeviceSetup}>
          <Settings2 className="size-[18px]" aria-hidden />
        </TrayButton>
        <span className="mx-1 h-6 w-px bg-border" aria-hidden />
        <TrayButton label={`Disconnect from ${name}`} onClick={() => void voice.leave()} danger>
          <PhoneOff className="size-[18px]" aria-hidden />
        </TrayButton>
      </div>
    </div>
  );
}

export function TrayButton({
  label,
  onClick,
  children,
  active,
  highlight,
  danger,
  disabled,
  hint,
  size = "md",
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  active?: boolean;
  highlight?: boolean;
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
  size?: "md" | "lg";
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={disabled ? 0 : -1} className="inline-flex">
          <button
            type="button"
            onClick={onClick}
            aria-label={label}
            aria-pressed={active || highlight}
            disabled={disabled}
            className={cn(
              "flex items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40",
              size === "md" ? "size-9" : "size-11 rounded-full",
              danger ? "bg-destructive/15 text-destructive hover:bg-destructive hover:text-white" : active ? "bg-destructive/15 text-destructive hover:bg-destructive/25" : highlight ? "bg-primary/20 text-primary hover:bg-primary/30" : "text-foreground hover:bg-accent",
            )}
          >
            {children}
          </button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{hint ?? label}</TooltipContent>
    </Tooltip>
  );
}
