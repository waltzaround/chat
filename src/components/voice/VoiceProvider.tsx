import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { RealtimeKitProvider, useRealtimeKitClient } from "@cloudflare/realtimekit-react";
import type RTKClient from "@cloudflare/realtimekit";
import type { RTKParticipant } from "@cloudflare/realtimekit";
import { toast } from "sonner";
import { apiPost, errorMessage, isApiError } from "@/lib/api";
import { Permission, hasPermission } from "@/lib/permissions";
import { useRealtime } from "@/realtime/RealtimeProvider";
import { readVoicePrefs, writeVoicePref } from "@/hooks/useVoicePrefs";
import type { VoiceJoinResponse } from "@shared/types";
import { DeviceSetupSheet } from "./DeviceSetupSheet";

export type VoiceStatus = "idle" | "connecting" | "connected" | "reconnecting";

export interface VoiceState {
  channelId: string | null;
  status: VoiceStatus;
  muted: boolean;
  deafened: boolean;
  video: boolean;
  screen: boolean;
  permissions: number;
  joinedAt: number | null;
  /** Channel we can offer to rejoin after a page refresh. */
  rejoinOffer: string | null;
}

export interface VoiceApi extends VoiceState {
  meeting: RTKClient | undefined;
  connectedChannelId: string | null;
  canSpeak: boolean;
  canVideo: boolean;
  canScreenShare: boolean;
  join: (channelId: string) => Promise<void>;
  leave: () => Promise<void>;
  toggleMute: () => Promise<void>;
  toggleDeafen: () => Promise<void>;
  toggleVideo: () => Promise<void>;
  toggleScreenShare: () => Promise<void>;
  openDeviceSetup: () => void;
  dismissRejoin: () => void;
}

const VoiceContext = createContext<VoiceApi | null>(null);

export function useVoice(): VoiceApi {
  const ctx = useContext(VoiceContext);
  if (!ctx) throw new Error("useVoice outside VoiceProvider");
  return ctx;
}

const SESSION_KEY = "commons.voice.session";
const REJOIN_WINDOW_MS = 90_000;

const initialState: VoiceState = { channelId: null, status: "idle", muted: false, deafened: false, video: false, screen: false, permissions: 0, joinedAt: null, rejoinOffer: null };

export function VoiceProvider({ children }: { children: ReactNode }) {
  const rt = useRealtime();
  const [meeting, initMeeting] = useRealtimeKitClient({ resetOnLeave: true });
  const meetingRef = useRef<RTKClient | undefined>(undefined);
  const [state, setState] = useState<VoiceState>(() => {
    let rejoinOffer: string | null = null;
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { channelId: string; ts: number; workspaceId: string };
        if (saved.workspaceId === rt.workspaceId && Date.now() - saved.ts < REJOIN_WINDOW_MS) rejoinOffer = saved.channelId;
        else sessionStorage.removeItem(SESSION_KEY);
      }
    } catch {
      /* ignore */
    }
    return { ...initialState, rejoinOffer };
  });
  const stateRef = useRef(state);
  stateRef.current = state;
  const [setupOpen, setSetupOpen] = useState(false);
  const pendingJoin = useRef<string | null>(null);
  const cleanups = useRef<(() => void)[]>([]);
  const leavingRef = useRef(false);

  useEffect(() => {
    meetingRef.current = meeting;
  }, [meeting]);

  const patch = useCallback((p: Partial<VoiceState>) => setState((s) => ({ ...s, ...p })), []);

  /** Tell the WorkspaceHub what everyone else should see under the channel. */
  const syncHub = useCallback(
    (override?: Partial<VoiceState>) => {
      const s = { ...stateRef.current, ...override };
      if (!s.channelId) return;
      rt.setVoiceState({ channelId: s.channelId, muted: s.muted, deafened: s.deafened, video: s.video, screen: s.screen });
    },
    [rt],
  );

  const reset = useCallback(() => {
    for (const c of cleanups.current.splice(0)) c();
    sessionStorage.removeItem(SESSION_KEY);
    setState((s) => ({ ...initialState, muted: s.muted, deafened: s.deafened }));
  }, []);

  const teardown = useCallback(
    async (notifyServer: boolean) => {
      const m = meetingRef.current;
      const s = stateRef.current;
      leavingRef.current = true;
      try {
        if (m) await m.leave();
      } catch (err) {
        console.warn("leave failed", err);
      }
      if (s.channelId) {
        rt.setVoiceState({ channelId: null });
        if (notifyServer) void apiPost(`/api/channels/${s.channelId}/voice/leave`, { durationMs: s.joinedAt ? Date.now() - s.joinedAt : 0 }).catch(() => undefined);
      }
      reset();
      leavingRef.current = false;
    },
    [rt, reset],
  );

  const applyDeafen = useCallback((m: RTKClient, deafened: boolean) => {
    for (const p of m.participants.joined.toArray()) {
      if (deafened) m.audio.removeParticipantTrack(p.id);
      else if (p.audioEnabled && p.audioTrack) m.audio.addParticipantTrack(p.id, p.audioTrack);
    }
  }, []);

  const doJoin = useCallback(
    async (channelId: string) => {
      if (meetingRef.current || stateRef.current.channelId) await teardown(true);
      patch({ channelId, status: "connecting", video: false, screen: false, rejoinOffer: null });
      try {
        const res = await apiPost<VoiceJoinResponse>(`/api/channels/${channelId}/voice/join`);
        const prefs = readVoicePrefs();
        const canSpeak = hasPermission(res.permissions, Permission.SPEAK);
        const startMuted = stateRef.current.muted || stateRef.current.deafened || !canSpeak;
        const client = await initMeeting({
          authToken: res.authToken,
          defaults: {
            audio: !startMuted,
            video: false,
            autoSwitchAudioDevice: true,
            mediaConfiguration: { audio: { echoCancellation: prefs.echoCancellation, noiseSuppression: prefs.noiseSuppression } as never },
          },
        });
        if (!client) throw new Error("Could not initialise the voice client");
        meetingRef.current = client;
        patch({ permissions: res.permissions, muted: startMuted });

        // Preferred devices.
        try {
          const [mics, cams, speakers] = await Promise.all([client.self.getAudioDevices(), client.self.getVideoDevices(), client.self.getSpeakerDevices()]);
          const mic = mics.find((d) => d.deviceId === prefs.micId);
          const cam = cams.find((d) => d.deviceId === prefs.cameraId);
          const spk = speakers.find((d) => d.deviceId === prefs.speakerId);
          if (mic) await client.self.setDevice(mic);
          if (cam) await client.self.setDevice(cam);
          if (spk) client.audio.setSpeakerDevice(spk.deviceId);
        } catch (err) {
          console.warn("device preference failed", err);
        }

        // Listeners (typed loosely: the SDK's event maps are wide).
        const self = client.self as unknown as { on: (e: string, h: (...a: never[]) => void) => void; off: (e: string, h: (...a: never[]) => void) => void };
        const meta = client.meta as unknown as { on: (e: string, h: (...a: never[]) => void) => void; off: (e: string, h: (...a: never[]) => void) => void };
        const parts = client.participants.joined as unknown as { on: (e: string, h: (...a: never[]) => void) => void; off: (e: string, h: (...a: never[]) => void) => void };
        const listen = (target: typeof self, event: string, handler: (...a: never[]) => void) => {
          target.on(event, handler);
          cleanups.current.push(() => target.off(event, handler));
        };

        listen(self, "roomJoined", ((payload: { reconnected: boolean }) => {
          patch({ status: "connected", joinedAt: stateRef.current.joinedAt ?? Date.now() });
          sessionStorage.setItem(SESSION_KEY, JSON.stringify({ channelId, ts: Date.now(), workspaceId: rt.workspaceId }));
          syncHub({ channelId, status: "connected" });
          if (payload?.reconnected) toast.success("Voice reconnected");
          if (stateRef.current.deafened) applyDeafen(client, true);
        }) as never);
        listen(self, "roomLeft", ((payload: { state: string }) => {
          if (leavingRef.current || payload?.state === "left") return;
          const reason = payload?.state;
          if (reason === "kicked") toast.error("You were removed from the voice room");
          else if (reason === "ended") toast.message("The voice room ended");
          else if (reason === "disconnected" || reason === "failed") toast.error("Voice connection lost");
          rt.setVoiceState({ channelId: null });
          reset();
        }) as never);
        listen(self, "audioUpdate", ((p: { audioEnabled: boolean }) => {
          patch({ muted: !p.audioEnabled });
          syncHub({ muted: !p.audioEnabled });
        }) as never);
        listen(self, "videoUpdate", ((p: { videoEnabled: boolean }) => {
          patch({ video: p.videoEnabled });
          syncHub({ video: p.videoEnabled });
        }) as never);
        listen(self, "screenShareUpdate", ((p: { screenShareEnabled: boolean }) => {
          const was = stateRef.current.screen;
          patch({ screen: p.screenShareEnabled });
          syncHub({ screen: p.screenShareEnabled });
          if (was && !p.screenShareEnabled) toast.message("Screen sharing ended");
        }) as never);
        listen(self, "mediaPermissionError", ((p: { kind: string; message: string }) => {
          if (p.kind === "audio") toast.error("Microphone access was denied — you are connected but muted. Allow the microphone in your browser settings to talk.");
          else if (p.kind === "video") toast.error("Camera access was denied. Allow the camera in your browser settings to turn on video.");
          else if (p.kind === "screenshare") {
            if (p.message !== "CANCELED") toast.error("Screen sharing could not start");
            patch({ screen: false });
          }
        }) as never);
        listen(self, "autoplayError", (() => {
          toast.message("Click anywhere to enable audio playback");
          const resume = () => {
            void client.audio.play().catch(() => undefined);
            window.removeEventListener("pointerdown", resume);
          };
          window.addEventListener("pointerdown", resume, { once: true });
        }) as never);
        listen(meta, "socketConnectionUpdate", ((s: { state: string }) => {
          if (s.state === "reconnecting") patch({ status: "reconnecting" });
          else if (s.state === "connected" && stateRef.current.status === "reconnecting") patch({ status: "connected" });
          else if (s.state === "failed") {
            toast.error("Voice connection failed");
            void teardown(true);
          }
        }) as never);
        listen(parts, "participantJoined", ((p: RTKParticipant) => {
          if (stateRef.current.deafened) client.audio.removeParticipantTrack(p.id);
        }) as never);
        listen(parts, "audioUpdate", ((p: RTKParticipant) => {
          if (stateRef.current.deafened) client.audio.removeParticipantTrack(p.id);
        }) as never);

        await client.join();
      } catch (err) {
        console.error("voice join failed", err);
        if (isApiError(err, "not_configured")) toast.error("Voice is not configured on this deployment yet. Add the RealtimeKit secrets to enable it.");
        else toast.error(errorMessage(err, "Could not join the voice room"));
        try {
          await meetingRef.current?.leave();
        } catch {
          /* ignore */
        }
        rt.setVoiceState({ channelId: null });
        reset();
      }
    },
    [applyDeafen, initMeeting, patch, reset, rt, syncHub, teardown],
  );

  const join = useCallback(
    async (channelId: string) => {
      if (stateRef.current.channelId === channelId && stateRef.current.status !== "idle") return;
      if (!readVoicePrefs().setupDone) {
        pendingJoin.current = channelId;
        setSetupOpen(true);
        return;
      }
      await doJoin(channelId);
    },
    [doJoin],
  );

  const leave = useCallback(() => teardown(true), [teardown]);

  const toggleMute = useCallback(async () => {
    const m = meetingRef.current;
    const s = stateRef.current;
    if (!m || !hasPermission(s.permissions, Permission.SPEAK)) return;
    try {
      if (s.muted) {
        if (s.deafened) {
          patch({ deafened: false });
          applyDeafen(m, false);
        }
        await m.self.enableAudio();
      } else await m.self.disableAudio();
    } catch (err) {
      toast.error(errorMessage(err, "Could not change microphone state"));
    }
  }, [applyDeafen, patch]);

  const toggleDeafen = useCallback(async () => {
    const m = meetingRef.current;
    const s = stateRef.current;
    if (!m) return;
    const next = !s.deafened;
    patch({ deafened: next });
    applyDeafen(m, next);
    if (next && !s.muted) await m.self.disableAudio().catch(() => undefined);
    syncHub({ deafened: next, muted: next ? true : s.muted });
  }, [applyDeafen, patch, syncHub]);

  const toggleVideo = useCallback(async () => {
    const m = meetingRef.current;
    const s = stateRef.current;
    if (!m || !hasPermission(s.permissions, Permission.VIDEO)) return;
    try {
      if (s.video) await m.self.disableVideo();
      else await m.self.enableVideo();
    } catch (err) {
      toast.error(errorMessage(err, "Could not change camera state"));
    }
  }, []);

  const toggleScreenShare = useCallback(async () => {
    const m = meetingRef.current;
    const s = stateRef.current;
    if (!m || !hasPermission(s.permissions, Permission.SCREEN_SHARE)) return;
    try {
      if (s.screen) await m.self.disableScreenShare();
      else await m.self.enableScreenShare();
    } catch (err) {
      // The browser picker being dismissed is not an error worth shouting about.
      const msg = errorMessage(err, "");
      if (!/cancel|denied|abort|NotAllowed/i.test(msg)) toast.error(msg || "Could not start screen sharing");
    }
  }, []);

  // Leave voice when the provider unmounts (workspace switch / logout).
  useEffect(() => {
    return () => {
      if (meetingRef.current) void meetingRef.current.leave().catch(() => undefined);
    };
  }, []);

  const value = useMemo<VoiceApi>(
    () => ({
      ...state,
      meeting,
      connectedChannelId: state.status === "idle" ? null : state.channelId,
      canSpeak: hasPermission(state.permissions, Permission.SPEAK),
      canVideo: hasPermission(state.permissions, Permission.VIDEO),
      canScreenShare: hasPermission(state.permissions, Permission.SCREEN_SHARE),
      join,
      leave,
      toggleMute,
      toggleDeafen,
      toggleVideo,
      toggleScreenShare,
      openDeviceSetup: () => setSetupOpen(true),
      dismissRejoin: () => {
        sessionStorage.removeItem(SESSION_KEY);
        patch({ rejoinOffer: null });
      },
    }),
    [state, meeting, join, leave, toggleMute, toggleDeafen, toggleVideo, toggleScreenShare, patch],
  );

  return (
    <VoiceContext.Provider value={value}>
      {children}
      <DeviceSetupSheet
        open={setupOpen}
        onOpenChange={(open) => {
          setSetupOpen(open);
          if (!open) pendingJoin.current = null;
        }}
        meeting={meeting}
        onDone={() => {
          writeVoicePref("setupDone", true);
          setSetupOpen(false);
          const next = pendingJoin.current;
          pendingJoin.current = null;
          if (next) void doJoin(next);
        }}
      />
    </VoiceContext.Provider>
  );
}

/** Renders children inside the RealtimeKit context only while a meeting exists. */
export function MeetingBoundary({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  const { meeting } = useVoice();
  if (!meeting) return <>{fallback ?? null}</>;
  return <RealtimeKitProvider value={meeting}>{children}</RealtimeKitProvider>;
}
