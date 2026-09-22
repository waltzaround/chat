import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRealtimeKitMeeting, useRealtimeKitSelector } from "@cloudflare/realtimekit-react";
import type { RTKParticipant, RTKSelf } from "@cloudflare/realtimekit";
import { Headphones, Loader2, Maximize2, Minimize2, PhoneCall, Users, Volume2 } from "lucide-react";
import { useMe, useMembers } from "@/lib/queries";
import { useVoiceParticipants } from "@/realtime/hooks";
import { memberDisplayName, roleColour } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/common/UserAvatar";
import { MeetingBoundary, useVoice } from "./VoiceProvider";
import { ParticipantTile, ScreenShareTile, type TileParticipant } from "./ParticipantTile";
import type { Channel, Member, WorkspaceDetail } from "@shared/types";

export function VoiceRoom({ channel, workspace }: { channel: Channel; workspace: WorkspaceDetail }) {
  const voice = useVoice();
  const inThisRoom = voice.connectedChannelId === channel.id;
  const presence = useVoiceParticipants(channel.id);
  const members = useMembers(workspace.id);
  const membersById = useMemo(() => new Map((members.data ?? []).map((m) => [m.userId, m])), [members.data]);

  if (!inThisRoom) {
    return <NotConnected channel={channel} presence={presence} membersById={membersById} roles={workspace.roles} onJoin={() => void voice.join(channel.id)} busy={voice.status === "connecting"} />;
  }
  return (
    <MeetingBoundary
      fallback={
        <div className="flex h-full items-center justify-center text-muted-foreground">
          <Loader2 className="size-6 animate-spin" aria-label="Connecting" />
        </div>
      }
    >
      <Stage channel={channel} workspace={workspace} membersById={membersById} />
    </MeetingBoundary>
  );
}

function NotConnected({ channel, presence, membersById, roles, onJoin, busy }: { channel: Channel; presence: { userId: string }[]; membersById: Map<string, Member>; roles: WorkspaceDetail["roles"]; onJoin: () => void; busy: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 p-6 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl border bg-card text-muted-foreground">
        <Volume2 className="size-7" aria-hidden />
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{channel.name}</h2>
        <p className="text-sm text-muted-foreground">{presence.length === 0 ? "No one is here yet — be the first to join." : `${presence.length} ${presence.length === 1 ? "person is" : "people are"} in the room.`}</p>
      </div>
      {presence.length ? (
        <ul className="flex flex-wrap justify-center gap-2" aria-label="People in the room">
          {presence.map((p) => {
            const m = membersById.get(p.userId);
            const name = m ? memberDisplayName(m) : "Unknown";
            return (
              <li key={p.userId} className="flex items-center gap-1.5 rounded-full border bg-card px-2 py-1 text-xs">
                <UserAvatar user={{ id: p.userId, displayName: name, avatarUrl: m?.avatarUrl ?? null }} size="xs" />
                <span style={{ color: m ? roleColour(m.roleIds, roles) ?? undefined : undefined }}>{name}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
      <Button size="lg" onClick={onJoin} disabled={busy} className="mt-2">
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <PhoneCall className="size-4" aria-hidden />}
        {busy ? "Connecting…" : "Join voice"}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live stage
// ---------------------------------------------------------------------------

function Stage({ channel, workspace, membersById }: { channel: Channel; workspace: WorkspaceDetail; membersById: Map<string, Member> }) {
  const { meeting } = useRealtimeKitMeeting();
  const me = useMe();
  const voice = useVoice();
  const self = useRealtimeKitSelector((m) => m.self);
  const joined = useRealtimeKitSelector((m) => m.participants.joined.toArray());
  const selfAudio = useRealtimeKitSelector((m) => m.self.audioEnabled);
  const selfVideo = useRealtimeKitSelector((m) => m.self.videoEnabled);
  const selfScreen = useRealtimeKitSelector((m) => m.self.screenShareEnabled);
  const [speaking, setSpeaking] = useState<Record<string, number>>({});
  const [focused, setFocused] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);

  // Active speaker tracking with a short decay.
  useEffect(() => {
    const parts = meeting.participants as unknown as { on: (e: string, h: (p: { peerId: string; volume: number }) => void) => void; off: (e: string, h: (p: { peerId: string; volume: number }) => void) => void };
    const handler = (p: { peerId: string; volume: number }) => {
      if (p.volume <= 0) return;
      setSpeaking((s) => ({ ...s, [p.peerId]: Date.now() }));
    };
    parts.on("activeSpeaker", handler);
    const sweep = setInterval(() => {
      const now = Date.now();
      setSpeaking((s) => {
        const next: Record<string, number> = {};
        let changed = false;
        for (const [k, v] of Object.entries(s)) {
          if (now - v < 1200) next[k] = v;
          else changed = true;
        }
        return changed ? next : s;
      });
    }, 400);
    return () => {
      parts.off("activeSpeaker", handler);
      clearInterval(sweep);
    };
  }, [meeting]);

  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stageRef.current?.requestFullscreen?.();
  }, []);

  const tiles = useMemo<TileParticipant[]>(() => {
    const mapSelf = (s: RTKSelf): TileParticipant => {
      const m = membersById.get(me.data?.id ?? "");
      return {
        key: `self`,
        peerId: s.id,
        userId: me.data?.id ?? s.customParticipantId ?? "me",
        name: m ? memberDisplayName(m) : me.data?.displayName ?? s.name,
        avatarUrl: m?.avatarUrl ?? me.data?.avatarUrl ?? null,
        roleColour: m ? roleColour(m.roleIds, workspace.roles) : null,
        isSelf: true,
        audioEnabled: selfAudio,
        videoEnabled: selfVideo,
        videoTrack: selfVideo ? s.videoTrack : null,
        screenShareEnabled: selfScreen,
        screenTrack: selfScreen ? s.screenShareTracks?.video ?? null : null,
      };
    };
    const mapRemote = (p: RTKParticipant): TileParticipant => {
      const userId = p.customParticipantId ?? p.userId;
      const m = membersById.get(userId);
      return {
        key: p.id,
        peerId: p.id,
        userId,
        name: m ? memberDisplayName(m) : p.name,
        avatarUrl: m?.avatarUrl ?? (p.picture || null),
        roleColour: m ? roleColour(m.roleIds, workspace.roles) : null,
        isSelf: false,
        audioEnabled: p.audioEnabled,
        videoEnabled: p.videoEnabled,
        videoTrack: p.videoEnabled ? p.videoTrack : null,
        screenShareEnabled: p.screenShareEnabled,
        screenTrack: p.screenShareEnabled ? p.screenShareTracks?.video ?? null : null,
      };
    };
    return [mapSelf(self), ...joined.map(mapRemote)];
  }, [self, joined, selfAudio, selfVideo, selfScreen, membersById, me.data, workspace.roles]);

  const screens = tiles.filter((t) => t.screenShareEnabled && t.screenTrack);
  const focusKey = focused && (screens.some((s) => `screen:${s.key}` === focused) || tiles.some((t) => t.key === focused)) ? focused : screens[0] ? `screen:${screens[0].key}` : null;
  const focusedScreen = focusKey?.startsWith("screen:") ? screens.find((s) => `screen:${s.key}` === focusKey) ?? null : null;
  const focusedTile = focusKey && !focusKey.startsWith("screen:") ? tiles.find((t) => t.key === focusKey) ?? null : null;
  const hasFocus = !!(focusedScreen || focusedTile);
  const anyVideo = tiles.some((t) => t.videoEnabled);
  const isSpeaking = (t: TileParticipant) => !!speaking[t.peerId] && t.audioEnabled;

  const cols = gridColumns(tiles.length);

  return (
    <div ref={stageRef} className={cn("relative flex h-full flex-col bg-rail", fullscreen && "bg-black")}>
      <div className="flex items-center gap-2 px-4 pt-3 text-xs text-muted-foreground">
        <Users className="size-3.5" aria-hidden />
        <span>
          {tiles.length} in {channel.name}
        </span>
        {voice.status === "reconnecting" ? (
          <span className="flex items-center gap-1 text-warning">
            <Loader2 className="size-3 animate-spin" aria-hidden /> Reconnecting…
          </span>
        ) : null}
        {voice.deafened ? (
          <span className="flex items-center gap-1 text-warning">
            <Headphones className="size-3" aria-hidden /> Deafened
          </span>
        ) : null}
        <span className="flex-1" />
        {hasFocus ? (
          <button type="button" onClick={() => setFocused(null)} className="rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground">
            Show grid
          </button>
        ) : null}
        <button type="button" onClick={toggleFullscreen} aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"} className="rounded p-1 hover:bg-accent hover:text-foreground">
          {fullscreen ? <Minimize2 className="size-3.5" aria-hidden /> : <Maximize2 className="size-3.5" aria-hidden />}
        </button>
      </div>

      {hasFocus ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
          <div className="min-h-0 flex-1">
            {focusedScreen ? (
              <ScreenShareTile participant={focusedScreen} large onStop={focusedScreen.isSelf ? () => void voice.toggleScreenShare() : undefined} />
            ) : focusedTile ? (
              <ParticipantTile participant={focusedTile} speaking={isSpeaking(focusedTile)} large />
            ) : null}
          </div>
          <ul className="flex h-24 shrink-0 gap-2 overflow-x-auto pb-1" aria-label="Participants">
            {screens
              .filter((s) => `screen:${s.key}` !== focusKey)
              .map((s) => (
                <li key={`screen:${s.key}`} className="aspect-video h-full shrink-0">
                  <ScreenShareTile participant={s} onSelect={() => setFocused(`screen:${s.key}`)} />
                </li>
              ))}
            {tiles
              .filter((t) => t.key !== focusKey)
              .map((t) => (
                <li key={t.key} className="aspect-video h-full shrink-0">
                  <ParticipantTile participant={t} speaking={isSpeaking(t)} onSelect={() => setFocused(t.key)} />
                </li>
              ))}
          </ul>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center p-3">
          <ul
            className={cn("grid w-full gap-2", anyVideo ? "max-h-full" : "max-w-4xl")}
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
            aria-label="Participants"
          >
            {tiles.map((t) => (
              <li key={t.key} className={cn(anyVideo ? "aspect-video" : "aspect-[4/3] max-h-56")}>
                <ParticipantTile participant={t} speaking={isSpeaking(t)} onSelect={t.videoEnabled ? () => setFocused(t.key) : undefined} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function gridColumns(n: number): number {
  if (n <= 1) return 1;
  if (n <= 4) return 2;
  if (n <= 9) return 3;
  return 4;
}
